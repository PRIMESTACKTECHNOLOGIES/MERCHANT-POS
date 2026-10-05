import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { bridgeService } from './bridgeService';
import type { Pos1011Batch } from './pos1011Batch';

export class Pos1011BatchManager {
  async createBatch(currency: string, asset = 'USDT') {
    const batch: Pos1011Batch = {
      id: uuidv4(), status: 'OPEN', currency: currency.toUpperCase(),
      asset: asset.toUpperCase(), totalAmountMinor: 0, txIds: [], createdAt: new Date().toISOString(),
    };
    await db.query(
      `INSERT INTO pos1011_batches (id,status,currency,asset,total_amount_minor,created_at) VALUES (?,?,?,?,?,?)`,
      [batch.id, batch.status, batch.currency, batch.asset, 0, batch.createdAt],
    );
    return batch;
  }

  async addToBatch(batchId: string, txId: string, amountMinor: number) {
    if (!txId || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('Valid transaction and amount are required');
    const batch = await db.query('SELECT * FROM pos1011_batches WHERE id = ? LIMIT 1', [batchId]);
    if (!batch.rowCount || batch.rows[0].status !== 'OPEN') throw new Error('Batch not open');
    const now = new Date().toISOString();
    await db.query('INSERT INTO pos1011_batch_items (batch_id,tx_id,amount_minor,created_at) VALUES (?,?,?,?)', [batchId, txId, amountMinor, now]);
    await db.query('UPDATE pos1011_batches SET total_amount_minor = total_amount_minor + ? WHERE id = ?', [amountMinor, batchId]);
    return this.getBatch(batchId);
  }

  async closeBatch(batchId: string) {
    const result = await db.query(`UPDATE pos1011_batches SET status = 'CLOSED' WHERE id = ? AND status = 'OPEN'`, [batchId]);
    if (!result.rowCount) throw new Error('Batch not found or already closed');
    return this.getBatch(batchId);
  }

  async settleBatch(batchId: string) {
    const batch = await db.query('SELECT * FROM pos1011_batches WHERE id = ? LIMIT 1', [batchId]);
    if (!batch.rowCount || batch.rows[0].status !== 'CLOSED') throw new Error('Batch must be closed before settlement');
    const row = batch.rows[0];
    const bridge = await bridgeService.settleToUsdt({
      amountMinor: Number(row.total_amount_minor), sourceCurrency: row.currency,
      protocol: 'POS_101_1_BATCH', authorizationReference: batchId,
    });
    if (bridge.status !== 'SETTLED') return { ...(await this.getBatch(batchId)), bridge };
    await db.query(`UPDATE pos1011_batches SET status = 'SETTLED', settled_at = ? WHERE id = ?`, [new Date().toISOString(), batchId]);
    return { ...(await this.getBatch(batchId)), bridge };
  }

  async getBatch(batchId: string) {
    const result = await db.query('SELECT * FROM pos1011_batches WHERE id = ? LIMIT 1', [batchId]);
    if (!result.rowCount) throw new Error('Batch not found');
    const row = result.rows[0];
    const items = await db.query('SELECT tx_id FROM pos1011_batch_items WHERE batch_id = ? ORDER BY created_at', [batchId]);
    return {
      id: row.id, status: row.status, currency: row.currency, asset: row.asset,
      totalAmountMinor: Number(row.total_amount_minor), txIds: items.rows.map((item: any) => item.tx_id),
      createdAt: row.created_at, settledAt: row.settled_at || undefined,
    } satisfies Pos1011Batch;
  }

  async listBatches() {
    const result = await db.query('SELECT * FROM pos1011_batches ORDER BY created_at DESC LIMIT 200');
    return Promise.all(result.rows.map((row: any) => this.getBatch(row.id)));
  }
}

export const pos1011BatchManager = new Pos1011BatchManager();
