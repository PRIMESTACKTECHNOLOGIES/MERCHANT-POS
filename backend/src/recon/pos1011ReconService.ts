import { db } from '../config/db';

export class Pos1011ReconService {
  async buildRecon() {
    const result = await db.query(`
      SELECT e.tx_id, MAX(e.amount_minor) AS amount_minor, MAX(e.currency) AS currency,
             MAX(CASE WHEN e.event_type = 'ISSUER_AUTH' THEN json_extract(e.meta_json, '$.approved') END) AS issuer_approved,
             MAX(CASE WHEN e.event_type = 'ISSUER_AUTH' THEN json_extract(e.meta_json, '$.responseCode') END) AS issuer_response_code,
             MAX(CASE WHEN e.event_type = 'BRIDGE_SETTLEMENT' THEN json_extract(e.meta_json, '$.status') END) AS bridge_status,
             MAX(CASE WHEN e.event_type = 'PAYOUT' THEN e.status END) AS payout_status,
             MAX(e.created_at) AS created_at,
             i.batch_id, b.status AS batch_status
      FROM pos1011_events e
      LEFT JOIN pos1011_batch_items i ON i.tx_id = e.tx_id
      LEFT JOIN pos1011_batches b ON b.id = i.batch_id
      GROUP BY e.tx_id
      ORDER BY created_at DESC
      LIMIT 500
    `);
    return result.rows;
  }
}

export const pos1011ReconService = new Pos1011ReconService();
