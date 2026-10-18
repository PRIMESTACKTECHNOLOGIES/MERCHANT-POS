import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';
import { XsdValidationResult } from './xsdValidator.service';
import { ParsedIso20022Document } from './parser.service';

/**
 * Persistence for ISO 20022 payments-initiation traffic.
 *
 * Every message that crosses the processor boundary — generated outbound or
 * ingested inbound — is stored verbatim together with the header facts and the
 * outcome of the XSD validation run. The per-transaction rows give the
 * reconciliation engine an indexed lookup by EndToEndId / UETR, which is the
 * only identifier guaranteed to survive the whole chain.
 *
 * Writes are idempotent on `(message_id, message_type)`: re-persisting the same
 * message updates the stored copy instead of duplicating it.
 */

export type Iso20022Direction = 'OUTBOUND' | 'INBOUND';
export type Iso20022Source = 'GENERATED' | 'INGESTED' | 'WEBHOOK';

export interface Iso20022MessageRow {
  id: string;
  message_id: string;
  message_type: string;
  message_name: string;
  direction: Iso20022Direction;
  root_element: string;
  namespace: string;
  creation_datetime: string | null;
  number_of_transactions: number | null;
  control_sum: number | null;
  currency: string | null;
  initiating_party: string | null;
  original_message_id: string | null;
  original_message_name_id: string | null;
  group_status: string | null;
  source: Iso20022Source;
  xsd_valid: number | null;
  xsd_result: string | null;
  payload: string;
  created_at: string;
  updated_at: string;
}

export interface Iso20022TransactionRow {
  id: string;
  message_row_id: string;
  message_id: string;
  message_type: string;
  direction: Iso20022Direction;
  payment_info_id: string | null;
  instruction_id: string | null;
  end_to_end_id: string | null;
  uetr: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  mandate_id: string | null;
  created_at: string;
}

let tablesReady: Promise<void> | null = null;

export function ensureIso20022Tables(): Promise<void> {
  if (tablesReady) return tablesReady;
  tablesReady = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS iso20022_messages (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        message_type TEXT NOT NULL,
        message_name TEXT NOT NULL,
        direction TEXT NOT NULL,
        root_element TEXT NOT NULL,
        namespace TEXT NOT NULL,
        creation_datetime TEXT,
        number_of_transactions INTEGER,
        control_sum REAL,
        currency TEXT,
        initiating_party TEXT,
        original_message_id TEXT,
        original_message_name_id TEXT,
        group_status TEXT,
        source TEXT NOT NULL,
        xsd_valid INTEGER,
        xsd_result TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (message_id, message_type)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS iso20022_transactions (
        id TEXT PRIMARY KEY,
        message_row_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        message_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        payment_info_id TEXT,
        instruction_id TEXT,
        end_to_end_id TEXT,
        uetr TEXT,
        amount REAL,
        currency TEXT,
        status TEXT,
        mandate_id TEXT,
        created_at TEXT NOT NULL
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_iso20022_messages_msgid ON iso20022_messages (message_id, message_type)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_iso20022_messages_original ON iso20022_messages (original_message_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_iso20022_tx_row ON iso20022_transactions (message_row_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_iso20022_tx_e2e ON iso20022_transactions (end_to_end_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_iso20022_tx_uetr ON iso20022_transactions (uetr)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_iso20022_tx_msgid ON iso20022_transactions (message_id, message_type)`);
  })().catch((error) => {
    tablesReady = null;
    throw error;
  });
  return tablesReady;
}

export interface PersistIso20022Input {
  xml: string;
  direction: Iso20022Direction;
  source: Iso20022Source;
  parsed: ParsedIso20022Document;
  validation?: XsdValidationResult | null;
}

export interface PersistIso20022Result {
  id: string;
  messageId: string;
  messageType: string;
  direction: Iso20022Direction;
  transactionRows: number;
  created: boolean;
}

/** Stores a message (and its transactions) idempotently on (MsgId, message type). */
export async function persistIso20022Message(input: PersistIso20022Input): Promise<PersistIso20022Result> {
  await ensureIso20022Tables();

  const { xml, direction, source, parsed, validation } = input;
  const payload = String(xml ?? '');
  if (!payload.trim()) throw new Error('Cannot persist an empty ISO 20022 document');

  const messageId = parsed.messageId ? String(parsed.messageId) : '';
  if (!messageId) {
    throw new Error(`${parsed.messageType} cannot be persisted without GrpHdr/MsgId`);
  }

  const currency = resolveMessageCurrency(parsed);
  const now = new Date().toISOString();

  await db.query('BEGIN IMMEDIATE');
  try {
    const existing = await db.query(
      `SELECT id FROM iso20022_messages WHERE message_id = ? AND message_type = ? LIMIT 1`,
      [messageId, parsed.messageType]
    );

    const rowId = existing.rows?.length ? String(existing.rows[0].id) : uuidv4();

    if (existing.rows?.length) {
      await db.query(
        `UPDATE iso20022_messages
            SET message_name = ?, direction = ?, root_element = ?, namespace = ?,
                creation_datetime = ?, number_of_transactions = ?, control_sum = ?, currency = ?,
                initiating_party = ?, original_message_id = ?, original_message_name_id = ?,
                group_status = ?, source = ?, xsd_valid = ?, xsd_result = ?, payload = ?, updated_at = ?
          WHERE id = ?`,
        [
          parsed.messageName,
          direction,
          parsed.rootElement,
          parsed.namespace,
          parsed.creationDateTime,
          parsed.numberOfTransactions,
          parsed.controlSum,
          currency,
          parsed.initiatingParty,
          parsed.originalMessageId,
          parsed.originalMessageNameId,
          parsed.groupStatus,
          source,
          validation ? (validation.valid ? 1 : 0) : null,
          validation ? validation.result : null,
          payload,
          now,
          rowId,
        ]
      );
      await db.query(`DELETE FROM iso20022_transactions WHERE message_row_id = ?`, [rowId]);
    } else {
      await db.query(
        `INSERT INTO iso20022_messages (
            id, message_id, message_type, message_name, direction, root_element, namespace,
            creation_datetime, number_of_transactions, control_sum, currency, initiating_party,
            original_message_id, original_message_name_id, group_status, source,
            xsd_valid, xsd_result, payload, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rowId,
          messageId,
          parsed.messageType,
          parsed.messageName,
          direction,
          parsed.rootElement,
          parsed.namespace,
          parsed.creationDateTime,
          parsed.numberOfTransactions,
          parsed.controlSum,
          currency,
          parsed.initiatingParty,
          parsed.originalMessageId,
          parsed.originalMessageNameId,
          parsed.groupStatus,
          source,
          validation ? (validation.valid ? 1 : 0) : null,
          validation ? validation.result : null,
          payload,
          now,
          now,
        ]
      );
    }

    let transactionRows = 0;
    for (const instruction of parsed.paymentInstructions) {
      for (const transaction of instruction.transactions) {
        await db.query(
          `INSERT INTO iso20022_transactions (
              id, message_row_id, message_id, message_type, direction, payment_info_id,
              instruction_id, end_to_end_id, uetr, amount, currency, status, mandate_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            rowId,
            messageId,
            parsed.messageType,
            direction,
            instruction.paymentInfoId || instruction.originalPaymentInfoId,
            transaction.instructionId,
            transaction.endToEndId,
            transaction.uetr,
            transaction.amount,
            transaction.currency,
            transaction.status,
            transaction.mandateId,
            now,
          ]
        );
        transactionRows += 1;
      }
    }

    await db.query('COMMIT');
    return {
      id: rowId,
      messageId,
      messageType: parsed.messageType,
      direction,
      transactionRows,
      created: !existing.rows?.length,
    };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

/** The document control currency, or null when the message mixes currencies. */
export function resolveMessageCurrency(parsed: ParsedIso20022Document): string | null {
  const currencies = new Set<string>();
  for (const instruction of parsed.paymentInstructions) {
    for (const transaction of instruction.transactions) {
      if (transaction.currency) currencies.add(transaction.currency);
    }
  }
  return currencies.size === 1 ? [...currencies][0] : null;
}

export interface Iso20022MessageSummary {
  id: string;
  messageId: string;
  messageType: string;
  messageName: string;
  direction: Iso20022Direction;
  creationDateTime: string | null;
  numberOfTransactions: number | null;
  controlSum: number | null;
  currency: string | null;
  initiatingParty: string | null;
  originalMessageId: string | null;
  groupStatus: string | null;
  source: Iso20022Source;
  xsdValid: boolean | null;
  xsdResult: string | null;
  createdAt: string;
  updatedAt: string;
}

function toSummary(row: Iso20022MessageRow): Iso20022MessageSummary {
  return {
    id: row.id,
    messageId: row.message_id,
    messageType: row.message_type,
    messageName: row.message_name,
    direction: row.direction,
    creationDateTime: row.creation_datetime,
    numberOfTransactions: row.number_of_transactions,
    controlSum: row.control_sum,
    currency: row.currency,
    initiatingParty: row.initiating_party,
    originalMessageId: row.original_message_id,
    groupStatus: row.group_status,
    source: row.source,
    xsdValid: row.xsd_valid === null || row.xsd_valid === undefined ? null : Number(row.xsd_valid) === 1,
    xsdResult: row.xsd_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listIso20022Messages(filters: {
  messageType?: string;
  direction?: string;
  originalMessageId?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ messages: Iso20022MessageSummary[]; total: number }> {
  await ensureIso20022Tables();

  const where: string[] = [];
  const params: any[] = [];
  if (filters.messageType) { where.push('message_type = ?'); params.push(filters.messageType); }
  if (filters.direction) { where.push('direction = ?'); params.push(String(filters.direction).toUpperCase()); }
  if (filters.originalMessageId) { where.push('original_message_id = ?'); params.push(filters.originalMessageId); }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const countResult = await db.query(`SELECT COUNT(*) AS total FROM iso20022_messages ${clause}`, params);
  const total = Number(countResult.rows?.[0]?.total ?? 0);

  const result = await db.query(
    `SELECT * FROM iso20022_messages ${clause} ORDER BY created_at DESC, message_id ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { messages: (result.rows || []).map((row: any) => toSummary(row as Iso20022MessageRow)), total };
}

export async function getIso20022Message(id: string): Promise<(Iso20022MessageSummary & { payload: string }) | null> {
  await ensureIso20022Tables();
  const result = await db.query(`SELECT * FROM iso20022_messages WHERE id = ? OR message_id = ? LIMIT 1`, [id, id]);
  if (!result.rows?.length) return null;
  const row = result.rows[0] as Iso20022MessageRow;
  return { ...toSummary(row), payload: row.payload };
}

export async function listIso20022Transactions(filters: {
  endToEndId?: string;
  uetr?: string;
  messageId?: string;
  messageType?: string;
  limit?: number;
} = {}): Promise<Iso20022TransactionRow[]> {
  await ensureIso20022Tables();

  const where: string[] = [];
  const params: any[] = [];
  if (filters.endToEndId) { where.push('end_to_end_id = ?'); params.push(filters.endToEndId); }
  if (filters.uetr) { where.push('uetr = ?'); params.push(filters.uetr); }
  if (filters.messageId) { where.push('message_id = ?'); params.push(filters.messageId); }
  if (filters.messageType) { where.push('message_type = ?'); params.push(filters.messageType); }

  if (!where.length) throw new Error('At least one of endToEndId, uetr, messageId or messageType is required');

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  const result = await db.query(
    `SELECT * FROM iso20022_transactions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
    [...params, limit]
  );
  return (result.rows || []) as Iso20022TransactionRow[];
}
