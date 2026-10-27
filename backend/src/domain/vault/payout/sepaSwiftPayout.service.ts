import { v4 as uuidv4 } from 'uuid';
import { db } from '../../../config/db';
import { convertCurrency } from './fx.service';

export type VaultPayoutType = 'SEPA' | 'SWIFT';
export type VaultPayoutStatus = 'PENDING' | 'SENT' | 'CONFIRMED' | 'FAILED';

export interface VaultPayoutInput {
  amount: number;
  currency: string;
  beneficiaryName: string;
  beneficiaryIban: string;
  beneficiaryBic: string;
  reference?: string;
  type: VaultPayoutType;
  vaultCurrency?: string;
}

function validateInput(input: VaultPayoutInput): void {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('amount must be a positive number');
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('currency must be a three-letter ISO code');
  if (!input.beneficiaryName?.trim()) throw new Error('beneficiaryName is required');
  if (!input.beneficiaryIban?.trim()) throw new Error('beneficiaryIban is required');
  if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(input.beneficiaryBic)) throw new Error('beneficiaryBic must be a valid BIC8 or BIC11');
}

export async function createVaultPayout(params: VaultPayoutInput) {
  const input = { ...params, currency: params.currency.toUpperCase(), beneficiaryBic: params.beneficiaryBic.toUpperCase() };
  validateInput(input);
  const vaultCurrency = String(input.vaultCurrency || input.currency).toUpperCase();
  const fixedFee = 5;
  const percentageFee = input.amount * 0.005;
  const fee = fixedFee + percentageFee;
  const debitAmount = await convertCurrency(input.amount + fee, input.currency, vaultCurrency);
  await db.query('BEGIN IMMEDIATE');
  try {
    const vaultRes = await db.query('SELECT id, balance FROM vault_accounts WHERE currency = ? LIMIT 1', [vaultCurrency]);
    if (!vaultRes.rows.length) throw new Error('Vault account not found');
    if (Number(vaultRes.rows[0].balance) < debitAmount) throw new Error('Insufficient vault balance');

    const id = uuidv4();
    const now = new Date().toISOString();
    await db.query(
      `UPDATE vault_accounts
          SET balance = balance - ?, updated_at = ?
        WHERE id = ? AND balance >= ?`,
      [debitAmount, now, vaultRes.rows[0].id, debitAmount],
    );
    await db.query(
      `INSERT INTO vault_payouts
        (id, idempotency_key, amount, currency, bank_account, beneficiary_name,
         beneficiary_iban, beneficiary_bic, reference, type, fee, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      [id, id, input.amount, input.currency, JSON.stringify({
        account_holder: input.beneficiaryName.trim(),
        iban: input.beneficiaryIban.trim(),
        swift_code: input.beneficiaryBic,
      }), input.beneficiaryName.trim(), input.beneficiaryIban.trim(),
      input.beneficiaryBic, input.reference?.trim() || null, input.type, fee, now, now],
    );
    await db.query('COMMIT');
    return { success: true, payoutId: id, status: 'PENDING' as const, fee, totalDebited: debitAmount, debitCurrency: vaultCurrency };
  } catch (error) {
    try { await db.query('ROLLBACK'); } catch { /* preserve original error */ }
    throw error;
  }
}

function xmlEscape(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export async function buildSepaPacs008Batch() {
  const result = await db.query(`SELECT * FROM vault_payouts WHERE status = 'PENDING' AND type = 'SEPA' ORDER BY created_at`);
  const txns = result.rows;
  const transactions = txns.map((txn: any) => `
      <CdtTrfTxInf>
        <PmtId><EndToEndId>${xmlEscape(txn.id)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="${xmlEscape(txn.currency)}">${Number(txn.amount).toFixed(2)}</InstdAmt></Amt>
        <Cdtr><Nm>${xmlEscape(txn.beneficiary_name)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${xmlEscape(txn.beneficiary_iban)}</IBAN></Id></CdtrAcct>
        <CdtrAgt><FinInstnId><BICFI>${xmlEscape(txn.beneficiary_bic)}</BICFI></FinInstnId></CdtrAgt>
        <RmtInf><Ustrd>${xmlEscape(txn.reference || '')}</Ustrd></RmtInf>
      </CdtTrfTxInf>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <PmtInf>
      <PmtInfId>VAULT-SEPA-BATCH-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${txns.length}</NbOfTxs>${transactions}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;
  return { xml, txns };
}

export async function buildSwiftMt103Batch() {
  const result = await db.query(`SELECT * FROM vault_payouts WHERE status = 'PENDING' AND type = 'SWIFT' ORDER BY created_at`);
  const content = result.rows.map((txn: any) => [
    `:20:${txn.id}`,
    `:32A:${txn.currency}${Number(txn.amount).toFixed(2).replace('.', ',')}`,
    `:50K:${txn.beneficiary_name}`,
    `:59:${txn.beneficiary_iban}`,
    `:57A:${txn.beneficiary_bic}`,
    `:70:${txn.reference || ''}`,
    '-',
  ].join('\n')).join('\n');
  return { content, txns: result.rows };
}

async function updateStatus(payoutIds: string[], status: VaultPayoutStatus): Promise<number> {
  if (!payoutIds.length) throw new Error('payoutIds must not be empty');
  const placeholders = payoutIds.map(() => '?').join(',');
  const result = await db.query(
    `UPDATE vault_payouts SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})`,
    [status, ...payoutIds],
  );
  return result.rowCount;
}

export const markPayoutsSent = (payoutIds: string[]) => updateStatus(payoutIds, 'SENT');
export const markPayoutConfirmed = (payoutId: string) => updateStatus([payoutId], 'CONFIRMED');
export const markPayoutFailed = (payoutId: string) => updateStatus([payoutId], 'FAILED');
