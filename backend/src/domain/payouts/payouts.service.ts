import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';
import { generateMt103, Mt103Payout, buildMt103FromPayout } from './mt103.service';
import { generateRtgs } from './rtgs.service';
import { buildPain001Xml } from '../../utils/pain001.builder';
import { generateUetr } from '../../utils/uetr.generator';
import {
  balancedLedgerEngine,
  BalancedTransactionResult,
} from '../ledger/ledger.service';
import { vaultEngine } from '../vault/vault.service';
import { getVaultLiquidity } from '../vault/liquidity.service';
import { appendVaultAudit } from '../vault/audit.service';

export type PayoutChannel = 'MT103' | 'SEPA' | 'RTGS' | 'WIRE' | 'INTERNAL';
export type PayoutDestinationType = 'bank' | 'wallet' | 'card';
export type PayoutStatus = 'PENDING' | 'QUEUED' | 'EXECUTING' | 'SENT' | 'CONFIRMED' | 'FAILED';

export interface DestinationBank {
  swift_bic?: string;
  account_number?: string;
  iban?: string;
  account_name?: string;
  account_holder?: string;
  routing_number?: string;
  account_type?: string;
  country?: string;
  city?: string;
  post_code?: string;
  dwolla_funding_source_url?: string;
  bank_name?: string;
  bank_address?: string;
  address_lines?: string[];
}

export interface CreatePayoutInput {
  source_account_id: string;
  destination_type?: PayoutDestinationType;
  destination_bank?: DestinationBank;
  beneficiary_id?: string;
  amount: number;
  currency: string;
  purpose?: string;
  internal_reference: string;
  channel?: PayoutChannel;
  merchant_id?: string;
  metadata?: Record<string, any>;
  charge_bearer?: 'SHA' | 'OUR' | 'BEN';
}

export interface PayoutRecord {
  id: string;
  source_account_id: string;
  destination_type: PayoutDestinationType;
  destination_bank?: DestinationBank;
  amount: number;
  currency: string;
  purpose?: string;
  internal_reference: string;
  channel: PayoutChannel;
  uetr?: string;
  status: PayoutStatus;
  external_reference?: string;
  merchant_id?: string;
  metadata?: Record<string, any>;
  generated_payload?: string;
  payload_format?: string;
  error_code?: string;
  error_message?: string;
  sent_at?: string;
  confirmed_at?: string;
  failed_at?: string;
  linked_ledger_transaction_id?: string;
  linked_vault_transfer_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ChannelOutput {
  payload: string;
  format: string;
  uetr?: string;
  reference?: string;
}

const STATUS_FLOW: Record<PayoutStatus, PayoutStatus[]> = {
  PENDING: ['QUEUED', 'EXECUTING', 'FAILED'],
  QUEUED: ['EXECUTING', 'SENT', 'FAILED'],
  EXECUTING: ['SENT', 'CONFIRMED', 'FAILED'],
  SENT: ['CONFIRMED', 'FAILED'],
  CONFIRMED: [],
  FAILED: [],
};

function validateStatusTransition(current: PayoutStatus, next: PayoutStatus): void {
  if (current === next) return;
  if (!STATUS_FLOW[current]?.includes(next)) {
    throw new Error(`Invalid payout status transition: ${current} → ${next}`);
  }
}

function buildStandardError(code: string, message: string, details?: Record<string, any>) {
  return { error: code, message, code, details: details || {} };
}

export class PayoutsService {
  async validateFunds(source_account_id: string, amount: number, currency: string): Promise<void> {
    const row = await vaultEngine.getAccount(source_account_id);
    if (!row) {
      throw Object.assign(new Error('Source account not found'),
        buildStandardError('ACCOUNT_NOT_FOUND', `Vault account ${source_account_id} not found`, { field: 'source_account_id' }));
    }
    if (row.currency && String(row.currency).toUpperCase() !== currency) {
      throw Object.assign(new Error('Source account currency mismatch'),
        buildStandardError('VALIDATION_ERROR',
          `Source account ${source_account_id} is denominated in ${row.currency}, not ${currency}`,
          { field: 'currency', source_account_currency: row.currency, requested_currency: currency }));
    }
    const balance = Number(row.balance || 0);
    const reserved = Number(row.reserved_hold || 0);
    const available = balance - reserved;
    if (Number(amount) > available) {
      throw Object.assign(new Error('Insufficient funds'),
        buildStandardError('NO_FUNDS',
          `Insufficient available balance: account ${source_account_id} has ${available} ${row.currency || currency} available, needs ${amount} ${currency}`,
          { source_account_id, available, reserved, balance, requested: amount, requested_currency: currency, account_currency: row.currency }));
    }
  }

  async reserveVaultFunds(source_account_id: string, amount: number): Promise<void> {
    await vaultEngine.reserveFunds(source_account_id, Number(amount));
  }

  async releaseVaultReserve(source_account_id: string, amount: number): Promise<void> {
    await vaultEngine.releaseReserve(source_account_id, Number(amount));
  }

  async debitVaultFinal(source_account_id: string, amount: number): Promise<void> {
    await vaultEngine.settleReservedFunds(source_account_id, Number(amount));
  }

  async resolveDestinationBank(input: CreatePayoutInput): Promise<DestinationBank> {
    if (input.destination_bank && Object.keys(input.destination_bank).some(k => (input.destination_bank as any)[k] != null)) {
      return input.destination_bank;
    }
    if (input.beneficiary_id) {
      const ben = await db.query(
        `SELECT * FROM vault_beneficiaries WHERE id = ? LIMIT 1`,
        [input.beneficiary_id]
      );
      if (!ben.rows?.length) {
        throw Object.assign(new Error('Beneficiary not found'),
          buildStandardError('BENE_INVALID', `Beneficiary ${input.beneficiary_id} not found`, { field: 'beneficiary_id' }));
      }
      const b = ben.rows[0];
      return {
        swift_bic: b.swift,
        iban: b.iban,
        account_number: b.account_number,
        routing_number: b.routing_number,
        account_type: b.account_type,
        account_name: b.name,
        account_holder: b.name,
        bank_name: b.bank_name,
        country: b.country,
        bank_address: b.address,
      };
    }
    throw Object.assign(new Error('Missing destination'),
      buildStandardError('BENE_INVALID', 'Either destination_bank or beneficiary_id is required', { fields: ['destination_bank', 'beneficiary_id'] }));
  }

  async generateChannelPayload(
    channel: PayoutChannel,
    payout: PayoutRecord,
    dest: DestinationBank,
    source_acc?: any
  ): Promise<ChannelOutput> {
    const ccy = String(payout.currency || 'USD').toUpperCase();
    const amt = Number(payout.amount);

    switch (channel) {
      case 'MT103': {
        const sourceBic = String(source_acc?.bic || process.env.MT103_SENDER_BIC || '').toUpperCase().replace(/\s+/g, '');
        const mtInput: Mt103Payout = {
          senderBic: /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(sourceBic) ? sourceBic : 'PRSTUS33XXX',
          senderAccount: source_acc?.iban || process.env.MT103_SENDER_ACCOUNT || source_acc?.id || payout.source_account_id,
          senderName: source_acc?.bank_name || process.env.MT103_SENDER_NAME || 'Protocol 201.3 Settlement Bank',
          senderAddressLines: source_acc ? [source_acc.bank_name, source_acc.iban || ''].filter(Boolean) :
            (process.env.MT103_SENDER_ADDRESS || 'BUSINESS BAY,DUBAI, UAE').split(','),
          beneficiaryBic: dest.swift_bic || '',
          beneficiaryAccount: dest.iban || dest.account_number || '',
          beneficiaryName: dest.account_name || dest.account_holder || '',
          beneficiaryAddressLines: [dest.bank_address, dest.country, dest.bank_name].filter(Boolean) as string[],
          amount: amt,
          currency: ccy,
          valueDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
          internalReference: payout.internal_reference,
          remittanceInfo: payout.purpose || `Payout ${payout.id.slice(0, 8)}`,
          chargeBearer: (payout.metadata?.charge_bearer as 'SHA' | 'OUR' | 'BEN') || 'SHA',
          uetr: payout.uetr,
        };
        const res = generateMt103(mtInput);
        return { payload: res.message, format: 'MT103_TEXT', uetr: res.uetr, reference: res.reference };
      }
      case 'SEPA': {
        const msgId = `PAYOUT${payout.id.replace(/-/g, '').slice(0, 24).toUpperCase()}`;
        const xml = buildPain001Xml({
          msgId,
          createdAt: new Date().toISOString(),
          debtor: {
            name: source_acc?.bank_name || 'Protocol 201.3 Settlement Bank',
            bic: source_acc?.bic || 'PROCESSOR_BIC_PLACEHOLDER',
            iban: source_acc?.iban || 'PROCESSOR_IBAN_PLACEHOLDER',
          },
          transactions: [{
            instrId: `INSTR-${payout.id.slice(0, 16).toUpperCase()}`,
            endToEndId: payout.internal_reference,
            amount: amt,
            currency: ccy,
            creditorName: dest.account_name || dest.account_holder || 'Creditor',
            creditorIban: dest.iban || dest.account_number || '',
            creditorBic: dest.swift_bic || 'UNKNOWNBIC',
            remittanceInfo: payout.purpose || `SEPA Payout ${payout.internal_reference}`,
          }],
        });
        return { payload: xml, format: 'PAIN001_XML', uetr: payout.uetr || generateUetr(), reference: msgId };
      }
      case 'INTERNAL': {
        const internalJson = JSON.stringify({
          payout_id: payout.id,
          source_account_id: payout.source_account_id,
          amount: amt,
          currency: ccy,
          destination_bank: dest,
          reference: payout.internal_reference,
          generated_at: new Date().toISOString(),
        });
        return { payload: internalJson, format: 'INTERNAL_JSON', uetr: payout.uetr || generateUetr(), reference: payout.internal_reference };
      }
      case 'RTGS': {
        const uetr = payout.uetr || generateUetr();
        const result = generateRtgs({
          messageId: `RTGS${payout.id.replace(/[^A-Z0-9]/gi, '').slice(0, 28).toUpperCase()}`,
          uetr,
          valueDate: new Date().toISOString().slice(0, 10),
          senderBic: source_acc?.bic || process.env.RTGS_SENDER_BIC || 'PRSTUS33XXX',
          senderName: source_acc?.bank_name || process.env.RTGS_SENDER_NAME || 'Protocol 201.3 Settlement Bank',
          senderAccount: source_acc?.iban || source_acc?.id || payout.source_account_id,
          beneficiaryBic: dest.swift_bic || '',
          beneficiaryName: dest.account_name || dest.account_holder || '',
          beneficiaryAccount: dest.iban || dest.account_number || '',
          amount: amt,
          currency: ccy,
          reference: payout.internal_reference,
          purpose: payout.purpose,
        });
        return { payload: result.message, format: result.format, uetr: result.uetr, reference: result.reference };
      }
      case 'WIRE': {
        const wirePayload = JSON.stringify({
          channel,
          payout_id: payout.id,
          source_account_id: payout.source_account_id,
          destination_bank: dest,
          amount: amt,
          currency: ccy,
          uetr: payout.uetr || generateUetr(),
          reference: payout.internal_reference,
          purpose: payout.purpose,
          generated_at: new Date().toISOString(),
        });
        return { payload: wirePayload, format: 'WIRE_JSON_ENVELOPE', uetr: payout.uetr || generateUetr(), reference: payout.internal_reference };
      }
      default:
        throw Object.assign(new Error('Unsupported channel'),
          buildStandardError('CHANNEL_UNSUPPORTED', `Channel ${channel} is not supported`, { supported_channels: ['MT103', 'SEPA', 'RTGS', 'WIRE', 'INTERNAL'], requested: channel }));
    }
  }

  async createPayout(input: CreatePayoutInput): Promise<{ payout: PayoutRecord; ledger: BalancedTransactionResult }> {
    if (!input.source_account_id) {
      throw Object.assign(new Error('source_account_id is required'),
        buildStandardError('VALIDATION_ERROR', 'source_account_id is required', { field: 'source_account_id' }));
    }
    if (!input.amount || Number(input.amount) <= 0) {
      throw Object.assign(new Error('Invalid amount'),
        buildStandardError('VALIDATION_ERROR', 'amount must be a positive number', { field: 'amount' }));
    }
    if (!/^[A-Z]{3}$/.test(String(input.currency || '').toUpperCase())) {
      throw Object.assign(new Error('Invalid currency'),
        buildStandardError('VALIDATION_ERROR', 'currency must be a 3-letter ISO code (USD, ZAR, EUR, ...)', { field: 'currency' }));
    }
    if (!input.internal_reference) {
      throw Object.assign(new Error('internal_reference is required'),
        buildStandardError('VALIDATION_ERROR', 'internal_reference is required (your unique payout trace for ledger)', { field: 'internal_reference' }));
    }

    const channel = String(input.channel || 'MT103').toUpperCase() as PayoutChannel;
    const supportedChannels: PayoutChannel[] = ['MT103', 'SEPA', 'RTGS', 'WIRE', 'INTERNAL'];
    if (!supportedChannels.includes(channel)) {
      throw Object.assign(new Error(`Channel ${channel} is not supported`),
        buildStandardError('CHANNEL_UNSUPPORTED', `Channel ${channel} is not supported`, {
          field: 'channel',
          supported_channels: supportedChannels,
        }));
    }
    const destination_type: PayoutDestinationType = input.destination_type || 'bank';
    const currency = String(input.currency).toUpperCase();
    const amount = Number(input.amount);
    if (!Number.isFinite(amount)) {
      throw Object.assign(new Error('Invalid amount'),
        buildStandardError('VALIDATION_ERROR', 'amount must be a finite number', { field: 'amount' }));
    }
    const now = new Date().toISOString();

    await this.validateFunds(input.source_account_id, amount, currency);

    const dest = await this.resolveDestinationBank(input);
    if (destination_type === 'bank' && !dest.swift_bic) {
      throw Object.assign(new Error('Beneficiary SWIFT BIC is required'),
        buildStandardError('BENE_SWIFT_REQUIRED', 'Beneficiary bank details missing SWIFT BIC', {
          field: 'destination_bank.swift_bic',
        }));
    }
    if (destination_type === 'bank' && !(dest.account_number || dest.iban)) {
      throw Object.assign(new Error('Beneficiary account number or IBAN is required'),
        buildStandardError('BENE_ACCOUNT_REQUIRED', 'Beneficiary bank details missing account number or IBAN', {
          field: 'destination_bank.account_number',
        }));
    }

    const srcAcc = await db.query(`SELECT * FROM vault_accounts WHERE id = ? LIMIT 1`, [input.source_account_id]);
    const source_acc = srcAcc.rows?.[0];

    const payoutId = `pout_${uuidv4()}`;
    const uetr = generateUetr().toUpperCase();
    const status: PayoutStatus = 'PENDING';

    const sourceCode = await balancedLedgerEngine.resolveVaultAccountCode(input.source_account_id);
    const merchantCode = input.merchant_id
      ? await balancedLedgerEngine.resolveMerchantWalletCode(input.merchant_id, currency)
      : `PROC_CARD_CLEARING_${currency}`;

    const ledgerResult = await balancedLedgerEngine.createBalancedTransaction({
      type: 'payout',
      status: 'AUTHORIZED',
      amount,
      currency,
      reference: input.internal_reference,
      merchant_id: input.merchant_id,
      linked_payout_id: payoutId,
      metadata: { channel, source_account_id: input.source_account_id, destination_type, ...(input.metadata || {}) },
      entries: [
        {
          account_code: merchantCode,
          direction: 'debit',
          amount,
          currency,
          description: `Payout ${input.internal_reference} · ${channel} · ${dest.account_name || dest.iban || 'beneficiary'}`,
          merchant_id: input.merchant_id,
          source_type: 'pos',
          source_reference: payoutId,
        },
        {
          account_code: sourceCode,
          direction: 'credit',
          amount,
          currency,
          description: `Vault reserve for payout ${input.internal_reference} (${channel})`,
          source_type: 'bank',
          source_reference: payoutId,
        },
      ],
    });

    await this.reserveVaultFunds(input.source_account_id, amount);

    const payout: PayoutRecord = {
      id: payoutId,
      source_account_id: input.source_account_id,
      destination_type,
      destination_bank: dest,
      amount,
      currency,
      purpose: input.purpose,
      internal_reference: input.internal_reference,
      channel,
      uetr,
      status,
      merchant_id: input.merchant_id,
      metadata: input.metadata,
      linked_ledger_transaction_id: ledgerResult.ledger_transaction_id,
      created_at: now,
      updated_at: now,
    };

    await db.query(
      `INSERT INTO payouts
         (id, source_account_id, destination_type, destination_bank, amount, currency, purpose,
          internal_reference, channel, uetr, status, merchant_id, metadata,
          linked_ledger_transaction_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        payoutId, input.source_account_id, destination_type,
        JSON.stringify(dest), amount, currency, input.purpose || null,
        input.internal_reference, channel, uetr, status,
        input.merchant_id || null, input.metadata ? JSON.stringify(input.metadata) : null,
        ledgerResult.ledger_transaction_id, now, now,
      ]
    );

    return { payout, ledger: ledgerResult };
  }

  async executePayout(payoutId: string): Promise<PayoutRecord> {
    const sel = await db.query(`SELECT * FROM payouts WHERE id = ? LIMIT 1`, [payoutId]);
    if (!sel.rows?.length) throw Object.assign(new Error('Payout not found'),
      buildStandardError('ACCOUNT_NOT_FOUND', `Payout ${payoutId} not found`, { payout_id: payoutId }));
    const row = sel.rows[0];
    const current = row.status as PayoutStatus;
    validateStatusTransition(current, 'EXECUTING');
    const liquidity = await getVaultLiquidity(String(row.currency || 'EUR'));
    if (liquidity.status === 'CRITICAL') {
      throw Object.assign(new Error('Payout execution blocked: vault liquidity is critical'), {
        code: 'LIQUIDITY_CRITICAL',
        details: liquidity,
      });
    }

    let dest: DestinationBank;
    try { dest = row.destination_bank ? JSON.parse(row.destination_bank) : {}; }
    catch { dest = {}; }

    const srcAcc = await db.query(`SELECT * FROM vault_accounts WHERE id = ? LIMIT 1`, [row.source_account_id]);
    const source_acc = srcAcc.rows?.[0];

    const payout: PayoutRecord = { ...row, destination_bank: dest };
    const output = await this.generateChannelPayload(payout.channel as PayoutChannel, payout, dest, source_acc);
    const now = new Date().toISOString();

    const newStatus: PayoutStatus = 'SENT';
    await db.query(
      `UPDATE payouts
          SET status = ?, generated_payload = ?, payload_format = ?, uetr = COALESCE(uetr, ?),
              sent_at = ?, updated_at = ?
        WHERE id = ?`,
      [newStatus, output.payload, output.format, output.uetr || null, now, now, payoutId]
    );

    if (row.linked_ledger_transaction_id) {
      await balancedLedgerEngine.transitionLedgerTransaction(row.linked_ledger_transaction_id, 'SETTLED');
    }

    await this.debitVaultFinal(row.source_account_id, Number(row.amount));
    await appendVaultAudit({
      actor: 'system',
      event: 'PAYOUT_EXECUTE',
      merchantId: row.merchant_id,
      amount: Number(row.amount),
      currency: row.currency,
      reference: row.id,
      before: { status: current },
      after: { status: newStatus },
      meta: { payoutId: row.id, sourceAccountId: row.source_account_id },
    });

    return this.getPayout(payoutId) as Promise<PayoutRecord>;
  }

  async markConfirmed(payoutId: string, external_reference?: string): Promise<PayoutRecord> {
    const sel = await db.query(`SELECT * FROM payouts WHERE id = ? LIMIT 1`, [payoutId]);
    if (!sel.rows?.length) throw new Error(`Payout ${payoutId} not found`);
    const row = sel.rows[0];
    validateStatusTransition(row.status as PayoutStatus, 'CONFIRMED');
    const now = new Date().toISOString();

    let metadata: Record<string, any> = {};
    try {
      metadata = row.metadata ? JSON.parse(row.metadata) : {};
    } catch {
      throw new Error('Payout metadata is invalid JSON');
    }

    const targetVaultId = String(metadata.target_vault_account || '').trim();
    if (targetVaultId) {
      const target = await db.query(
        `SELECT id, currency FROM vault_accounts WHERE id = ? LIMIT 1`,
        [targetVaultId],
      );
      if (!target.rows?.[0]) {
        throw new Error(`Target vault account ${targetVaultId} not found`);
      }
      if (String(target.rows[0].currency || '').toUpperCase() !== String(row.currency || '').toUpperCase()) {
        throw new Error(`Target vault account ${targetVaultId} currency mismatch`);
      }

      const creditReference = `WISE-CREDIT-${payoutId}`;
      const existingCredit = await db.query(
        `SELECT id FROM ledger_transactions WHERE reference = ? LIMIT 1`,
        [creditReference],
      );
      if (!existingCredit.rows?.[0]) {
        const sourceCode = await balancedLedgerEngine.resolveVaultAccountCode(String(row.source_account_id));
        const targetCode = await balancedLedgerEngine.resolveVaultAccountCode(targetVaultId);
        await balancedLedgerEngine.createBalancedTransaction({
          type: 'internal_transfer',
          status: 'SETTLED',
          amount: Number(row.amount),
          currency: String(row.currency).toUpperCase(),
          reference: creditReference,
          linked_payout_id: payoutId,
          metadata: {
            payout_id: payoutId,
            external_reference: external_reference || row.external_reference || null,
            source_account_id: row.source_account_id,
            target_vault_account: targetVaultId,
          },
          entries: [
            {
              account_code: sourceCode,
              direction: 'debit',
              amount: Number(row.amount),
              currency: String(row.currency).toUpperCase(),
              source_type: 'bank',
              source_reference: payoutId,
              description: `Wise sweep debit for ${payoutId}`,
            },
            {
              account_code: targetCode,
              direction: 'credit',
              amount: Number(row.amount),
              currency: String(row.currency).toUpperCase(),
              source_type: 'bank',
              source_reference: external_reference || payoutId,
              description: `Wise vault credit for ${payoutId}`,
            },
          ],
        });
        await db.query(
          `UPDATE vault_accounts
              SET balance = balance + ?, updated_at = ?
            WHERE id = ?`,
          [Number(row.amount), now, targetVaultId],
        );
      }
    }

    await db.query(
      `UPDATE payouts
          SET status = 'CONFIRMED', confirmed_at = ?,
              external_reference = COALESCE(?, external_reference), updated_at = ?
        WHERE id = ?`,
      [now, external_reference || null, now, payoutId]
    );

    if (row.linked_ledger_transaction_id) {
      try {
        const ext = external_reference || row.external_reference;
        await db.query(
          `UPDATE ledger_entries SET source_reference = COALESCE(source_reference, ?), status = 'SETTLED'
           WHERE ledger_transaction_id = ?`,
          [ext, row.linked_ledger_transaction_id]
        );
        await balancedLedgerEngine.transitionLedgerTransaction(row.linked_ledger_transaction_id, 'SETTLED');
      } catch (_) { /* ignore */ }
    }

    return this.getPayout(payoutId) as Promise<PayoutRecord>;
  }

  async failPayout(payoutId: string, error_code?: string, error_message?: string): Promise<PayoutRecord> {
    const sel = await db.query(`SELECT * FROM payouts WHERE id = ? LIMIT 1`, [payoutId]);
    if (!sel.rows?.length) throw new Error(`Payout ${payoutId} not found`);
    const row = sel.rows[0];
    if (row.status === 'CONFIRMED') throw new Error('Cannot fail a CONFIRMED payout');
    const now = new Date().toISOString();

    if (row.status !== 'FAILED') {
      try { await this.releaseVaultReserve(row.source_account_id, Number(row.amount)); } catch (_) { /* ignore */ }
    }

    await db.query(
      `UPDATE payouts
          SET status = 'FAILED', failed_at = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE id = ?`,
      [now, error_code || 'INTERNAL_ERROR', error_message || 'Payout failed', now, payoutId]
    );

    if (row.linked_ledger_transaction_id) {
      try { await balancedLedgerEngine.transitionLedgerTransaction(row.linked_ledger_transaction_id, 'FAILED'); }
      catch (_) { /* ignore */ }
    }

    return this.getPayout(payoutId) as Promise<PayoutRecord>;
  }

  async getPayout(payoutId: string): Promise<PayoutRecord | null> {
    const sel = await db.query(`SELECT * FROM payouts WHERE id = ? LIMIT 1`, [payoutId]);
    if (!sel.rows?.length) return null;
    const row = sel.rows[0];
    let dest: DestinationBank | undefined;
    try { if (row.destination_bank) dest = JSON.parse(row.destination_bank); } catch { /* ignore */ }
    let metadata: Record<string, any> | undefined;
    try { if (row.metadata) metadata = JSON.parse(row.metadata); } catch { /* ignore */ }
    return {
      ...row,
      destination_bank: dest,
      metadata,
    };
  }

  async listPayouts(params: {
    status?: PayoutStatus;
    channel?: PayoutChannel;
    merchant_id?: string;
    search?: string;
    source_account_id?: string;
    internal_reference?: string;
    uetr?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ count: number; rows: PayoutRecord[] }> {
    const conds: string[] = [];
    const args: any[] = [];
    if (params.status) { conds.push('status = ?'); args.push(params.status); }
    if (params.channel) { conds.push('channel = ?'); args.push(params.channel); }
    if (params.merchant_id) { conds.push('merchant_id = ?'); args.push(params.merchant_id); }
    if (params.source_account_id) { conds.push('source_account_id = ?'); args.push(params.source_account_id); }
    if (params.internal_reference) { conds.push('internal_reference = ?'); args.push(params.internal_reference); }
    if (params.uetr) { conds.push('uetr = ?'); args.push(params.uetr); }
    if (params.search) {
      const like = `%${params.search}%`;
      conds.push('(internal_reference LIKE ? OR id LIKE ? OR uetr LIKE ? OR external_reference LIKE ? OR JSON_EXTRACT(destination_bank, "$.account_name") LIKE ?)');
      args.push(like, like, like, like, like);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const limit = Math.min(Number(params.limit || 500), 5000);
    const offset = Number(params.offset || 0);

    const countR = await db.query(`SELECT COUNT(*) c FROM payouts ${where}`, args);
    const count = Number(countR.rows?.[0]?.c || 0);

    const rowsR = await db.query(
      `SELECT * FROM payouts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const rows: PayoutRecord[] = [];
    for (const row of rowsR.rows || []) {
      let dest: DestinationBank | undefined;
      try { if (row.destination_bank) dest = JSON.parse(row.destination_bank); } catch { /* ignore */ }
      let metadata: Record<string, any> | undefined;
      try { if (row.metadata) metadata = JSON.parse(row.metadata); } catch { /* ignore */ }
      rows.push({ ...row, destination_bank: dest, metadata });
    }
    return { count, rows };
  }
}

export const payoutsService = new PayoutsService();
