import { db } from '../../../config/db';

export async function convertCurrency(amount: number, from: string, to: string): Promise<number> {
  const source = from.toUpperCase();
  const target = to.toUpperCase();
  if (source === target) return amount;
  const result = await db.query(
    'SELECT rate FROM fx_rates WHERE from_currency = ? AND to_currency = ? ORDER BY updated_at DESC LIMIT 1',
    [source, target],
  );
  if (!result.rows.length) throw new Error(`FX rate not found for ${source}/${target}`);
  return amount * Number(result.rows[0].rate);
}

