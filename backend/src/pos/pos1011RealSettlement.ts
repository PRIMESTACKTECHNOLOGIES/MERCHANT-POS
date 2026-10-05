import { db } from '../config/db';
import { recordPosLedgerEvent } from './ledger';
import { getAvailableFunds, settleFunds } from '../services/globalServer/globalServerClient';

type ReceiverBank = {
  bankName: string;
  iban?: string;
  accountNumber?: string;
  swift?: string;
};

export type Pos1011RealSettlementInput = {
  sessionId: string;
  cardRef: string;
  amountMinor: number;
  currency: string;
  authCode: string;
  receiverBank: ReceiverBank;
};

function validateInput(input: Pos1011RealSettlementInput) {
  if (!input.sessionId.trim() || !input.cardRef.trim() || !input.authCode.trim()) {
    throw new Error('sessionId, cardRef, and authCode are required');
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('amountMinor must be a positive safe integer');
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new Error('currency must be a three-letter ISO currency code');
  }
  if (!input.receiverBank?.bankName?.trim()) {
    throw new Error('receiverBank.bankName is required');
  }
  if (!input.receiverBank.iban && !input.receiverBank.accountNumber) {
    throw new Error('receiverBank.iban or receiverBank.accountNumber is required');
  }
}

export async function processPos1011RealSettlement(input: Pos1011RealSettlementInput) {
  const normalized = { ...input, currency: input.currency.trim().toUpperCase() };
  validateInput(normalized);

  const existing = await db.query(
    `SELECT meta_json FROM pos1011_events
     WHERE tx_id = ? AND event_type = 'GLOBAL_SETTLEMENT' AND status = 'SETTLED'
     ORDER BY created_at DESC LIMIT 1`,
    [normalized.sessionId],
  );
  if (existing.rowCount > 0) {
    const meta = JSON.parse(String(existing.rows[0].meta_json || '{}')) as { settlement?: { settlementId?: string; settledMinor?: number; currency?: string; valueDate?: string } };
    const settlement = meta.settlement;
    if (settlement?.settlementId && typeof settlement.settledMinor === 'number' && settlement.currency) {
      return {
        status: 'CONFIRMED' as const,
        sessionId: normalized.sessionId,
        settlementId: settlement.settlementId,
        amountMinor: settlement.settledMinor,
        currency: settlement.currency,
        valueDate: settlement.valueDate,
        idempotent: true,
      };
    }
  }

  const balance = await getAvailableFunds(normalized.cardRef);
  if (balance.currency.toUpperCase() !== normalized.currency) {
    throw new Error('Currency mismatch between card and requested settlement');
  }
  if (balance.availableMinor < normalized.amountMinor) {
    throw new Error('Insufficient funds on global server');
  }

  await recordPosLedgerEvent(
    'GLOBAL_BALANCE_CHECK',
    normalized.amountMinor,
    normalized.currency,
    { balance, cardRef: normalized.cardRef, protocol: '101.1' },
    normalized.sessionId,
  );

  const settlement = await settleFunds({
    cardRef: normalized.cardRef,
    amountMinor: normalized.amountMinor,
    currency: normalized.currency,
    authCode: normalized.authCode,
    receiverBank: normalized.receiverBank,
    reference: normalized.sessionId,
  });

  await recordPosLedgerEvent(
    'GLOBAL_SETTLEMENT',
    settlement.settledMinor,
    settlement.currency,
    { settlement, receiverBank: normalized.receiverBank, protocol: '101.1' },
    normalized.sessionId,
  );

  return {
    status: 'CONFIRMED' as const,
    sessionId: normalized.sessionId,
    settlementId: settlement.settlementId,
    amountMinor: settlement.settledMinor,
    currency: settlement.currency,
    valueDate: settlement.valueDate,
  };
}
