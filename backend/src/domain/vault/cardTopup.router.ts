/**
 * Card Top-Up Router
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounted at: /api/card-topup
 *
 * Public (no auth):
 *   POST /webhook/transak          — Transak webhook (HMAC-verified internally)
 *
 * Authenticated (JWT required):
 *   GET  /balance/:cardId          — current card balance
 *   GET  /balance                  — all card balances
 *   GET  /history/:cardId          — transaction history
 *
 * Top-up endpoints (JWT required):
 *   POST /bank-wire                — Channel 1: SWIFT / SEPA / ACH wire
 *   POST /wise                     — Channel 2: Wise incoming transfer
 *   POST /crypto                   — Channel 3: USDT on-chain (TRC-20/BEP-20/ERC-20)
 *   POST /transak                  — Channel 4: Transak on-ramp (manual confirm)
 *   POST /cash                     — Channel 5: Cash deposit (operator-confirmed)
 *   POST /card-to-card             — Channel 6: Card-to-card transfer
 */

import { Router, type Request, type Response } from 'express';
import { authenticateToken } from '../../middleware/auth.middleware';
import {
  topupViaBankWire,
  confirmBankWireTopup,
  listPendingBankWires,
  topupViaWise,
  topupViaCrypto,
  topupViaTransak,
  topupViaCash,
  topupViaCardToCard,
  handleTransakTopupWebhook,
  EVM_PUBLIC_RPC,
} from './cardTopup.service';
import {
  getCardBalance,
  getCardHistory,
  listAllCardBalances,
} from './cardBalance.service';

const router = Router();

// ── Helper ────────────────────────────────────────────────────────────────────
function handleErr(res: Response, err: any) {
  console.error('[CardTopup]', err?.message || err);
  return res.status(500).json({ ok: false, error: err?.message || 'Internal error' });
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC — Transak webhook (no JWT — HMAC verified in service)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/webhook/transak', async (req: Request, res: Response) => {
  try {
    const signature = String(req.headers['x-transak-signature'] || req.headers['webhook-signature'] || '');
    await handleTransakTopupWebhook(req.body, signature);
    return res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === 'INVALID_SIGNATURE') return res.status(401).json({ ok: false, error: 'Invalid webhook signature' });
    return handleErr(res, err);
  }
});

// ── All routes below require authentication ──────────────────────────────────
router.use(authenticateToken);

// ═══════════════════════════════════════════════════════════════════════════
// BALANCE & HISTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/card-topup/balance
 * Returns all vault card balances.
 */
router.get('/balance', async (_req: Request, res: Response) => {
  try {
    const balances = await listAllCardBalances();
    return res.json({ ok: true, balances, count: balances.length });
  } catch (err: any) {
    return handleErr(res, err);
  }
});

/**
 * GET /api/card-topup/balance/:cardId?currency=USD
 * Returns balance for a specific card.
 */
router.get('/balance/:cardId', async (req: Request, res: Response) => {
  try {
    const { cardId } = req.params;
    const currency = String(req.query.currency || 'USD').toUpperCase();
    const balance = await getCardBalance(cardId, currency);
    return res.json({ ok: true, ...balance });
  } catch (err: any) {
    return handleErr(res, err);
  }
});

/**
 * GET /api/card-topup/history/:cardId?currency=USD&limit=50
 * Returns transaction history for a card.
 */
router.get('/history/:cardId', async (req: Request, res: Response) => {
  try {
    const { cardId } = req.params;
    const currency = req.query.currency ? String(req.query.currency).toUpperCase() : undefined;
    const limit    = Math.min(Number(req.query.limit || 100), 500);
    const history  = await getCardHistory(cardId, currency, limit);
    return res.json({ ok: true, cardId, count: history.length, history });
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FUNDING METHOD CATALOG
// ═══════════════════════════════════════════════════════════════════════════

export interface FundingField {
  name:         string;
  label:        string;
  type:         'text' | 'number' | 'password' | 'select';
  required?:    boolean;
  placeholder?: string;
  options?:     string[];
  defaultValue?: string;
}

export interface FundingMethod {
  id:         string;
  title:      string;
  subtitle:   string;
  group:      'bank' | 'wallet' | 'crypto' | 'ramp' | 'cash' | 'card';
  badge:      string;
  endpoint:   string;
  /** Plain-language statement of what is actually verified before the card is credited. */
  verifiedAgainst: string;
  /** False when the rail cannot be used until the operator supplies configuration. */
  available:  boolean;
  unavailableReason?: string;
  fixed?:     Record<string, string>;
  /** Plain-language checklist of exactly what to hand to whoever is loading the money. */
  provideToLoader: string[];
  fields:     FundingField[];
}

const envSet = (k: string) => Boolean((process.env[k] || '').trim());

/** EVM networks that can be verified without a scanner key (public RPC fallback). */
const EVM_NETWORKS = new Set(Object.keys(EVM_PUBLIC_RPC));

/** Human-readable network names for the loader checklist. */
const NETWORK_LABEL: Record<string, string> = {
  tron: 'TRON (TRC-20)',
  ethereum: 'Ethereum (ERC-20)',
  bsc: 'BNB Chain (BEP-20)',
  polygon: 'Polygon',
};

const CRYPTO_FIELDS = (network: string): FundingField[] => [
  { name: 'txHash', label: 'Transaction hash', type: 'text', required: true, placeholder: network === 'tron' ? 'TRON tx id' : '0x…' },
  { name: 'amount', label: 'Amount (USDT)', type: 'number', required: true, placeholder: '0.00' },
];

const WIRE_FIELDS = (): FundingField[] => [
  { name: 'amount', label: 'Amount', type: 'number', required: true, placeholder: '0.00' },
  { name: 'wireReference', label: 'Wire reference', type: 'text', required: true, placeholder: 'e.g. FEDWIRE-829301' },
  { name: 'senderName', label: 'Sender name', type: 'text', required: true, placeholder: 'Account holder' },
  { name: 'senderBank', label: 'Sender bank', type: 'text', placeholder: 'Bank name' },
  { name: 'operatorCode', label: 'Operator code', type: 'password', required: true, placeholder: '••••••••' },
];

/**
 * Every rail that can put real, spendable money on a vault card.
 * `available` is computed from live configuration so the UI can never offer a
 * method that would silently fail verification.
 */
export function listFundingMethods(): FundingMethod[] {
  // The vault-side detail that has to appear on the payment instruction so the
  // money lands in the right account, per rail.
  const WIRE_ACCOUNT_DETAIL: Record<string, string> = {
    SWIFT:           'the vault account number or IBAN, the receiving bank name and its country',
    SEPA:            'the vault account IBAN and the account holder name',
    ACH:             'the vault account number and ABA routing number',
    FEDWIRE:         'the vault account number and ABA routing number',
    FASTER_PAYMENTS: 'the vault account number and the UK sort code',
  };

  const wire = (id: string, title: string, subtitle: string, fixed: Record<string, string>): FundingMethod => {
    const transferType = fixed.transferType;
    return {
      id, title, subtitle, group: 'bank', badge: 'Operator-confirmed',
      endpoint: '/api/vault/cardtopup/bank-wire',
      verifiedAgainst: 'Recorded as PENDING, then credited only when an operator confirms the funds landed in the vault bank account.',
      available: envSet('VAULT_CASH_OPERATOR_CODE'),
      unavailableReason: envSet('VAULT_CASH_OPERATOR_CODE') ? undefined : 'Requires VAULT_CASH_OPERATOR_CODE to be set on this server.',
      provideToLoader: [
        `Where the money must land: ${WIRE_ACCOUNT_DETAIL[transferType] || 'the vault account number or IBAN'}.`,
        `Which rail to send on: ${transferType}.`,
        'The exact amount and currency. A different amount is refused when the wire is confirmed.',
        'A unique payment reference you invent and hand over, so the wire can be matched to this card.',
        'The warning that the card stays uncredited until an operator confirms the funds actually arrived.',
      ],
      fixed, fields: WIRE_FIELDS(),
    };
  };

  const crypto = (id: string, title: string, subtitle: string, network: string, envKey: string, scanner: string): FundingMethod => {
    // A scanner key is optional for EVM networks — verification falls back to a
    // keyless public JSON-RPC node (see EVM_PUBLIC_RPC in cardTopup.service).
    const hasKey = envSet(envKey);
    const keyless = EVM_NETWORKS.has(network);
    return {
      id, title, subtitle, group: 'crypto', badge: 'Verified',
      endpoint: '/api/vault/cardtopup/crypto',
      verifiedAgainst: keyless && !hasKey
        ? `Transaction and receipt are read from a public ${scanner} node; a reverted transfer or a mismatched USDT amount is rejected. Set ${envKey} to verify through the scanner API instead.`
        : `Transaction looked up on ${scanner} and the on-chain USDT amount must match the amount you enter.`,
      available: hasKey || keyless,
      unavailableReason: hasKey || keyless ? undefined : `Requires ${envKey} to be set on this server.`,
      provideToLoader: [
        `The vault USDT deposit address on ${NETWORK_LABEL[network] || network} — they must send on this exact network.`,
        'The exact USDT amount to send. A mismatched amount is refused.',
        'The warning to send USDT only — another token, or a transfer that reverts on-chain, is refused.',
        'The request to send you the transaction hash once the transfer confirms.',
      ],
      fixed: { network }, fields: CRYPTO_FIELDS(network),
    };
  };

  return [
    wire('wire_swift', 'SWIFT international wire', 'Cross-border, any currency', { transferType: 'SWIFT' }),
    wire('wire_sepa', 'SEPA transfer', 'EUR zone', { transferType: 'SEPA' }),
    wire('wire_ach', 'ACH transfer', 'USD domestic', { transferType: 'ACH' }),
    wire('wire_fedwire', 'Fedwire / RTGS', 'High-value USD / ZAR', { transferType: 'FEDWIRE' }),
    wire('wire_faster', 'Faster Payments', 'GBP domestic', { transferType: 'FASTER_PAYMENTS' }),

    {
      id: 'wise', title: 'Wise transfer', subtitle: 'Any Wise-supported currency', group: 'wallet', badge: 'Verified',
      endpoint: '/api/vault/cardtopup/wise',
      verifiedAgainst: 'Transfer fetched live from the Wise API; a transfer that is not completed is rejected.',
      available: envSet('WISE_API_KEY'),
      unavailableReason: envSet('WISE_API_KEY') ? undefined : 'Requires WISE_API_KEY to be set on this server.',
      provideToLoader: [
        'The vault Wise account details (account holder, account number or IBAN, and the currency) so they can send from their own Wise balance.',
        'The exact amount and currency to send.',
        'A reference you invent and hand over, so the transfer can be matched to this card.',
        'The request to send you the Wise transfer ID once it is marked completed — a transfer still pending is rejected.',
      ],
      fields: [
        { name: 'transferId', label: 'Wise transfer ID', type: 'text', required: true, placeholder: 'e.g. 1234567890' },
        { name: 'amount', label: 'Amount', type: 'number', required: true, placeholder: '0.00' },
      ],
    },

    crypto('usdt_tron', 'USDT — TRON (TRC-20)', 'TRC-20 deposit', 'tron', 'TRON_API_KEY', 'TronGrid'),
    crypto('usdt_ethereum', 'USDT — Ethereum (ERC-20)', 'ERC-20 deposit', 'ethereum', 'ETHERSCAN_API_KEY', 'Etherscan'),
    crypto('usdt_bsc', 'USDT — BNB Chain (BEP-20)', 'BEP-20 deposit', 'bsc', 'BSCSCAN_API_KEY', 'BscScan'),
    crypto('usdt_polygon', 'USDT — Polygon', 'Polygon deposit', 'polygon', 'POLYGONSCAN_API_KEY', 'PolygonScan'),

    {
      id: 'transak', title: 'Transak on-ramp', subtitle: 'Card / bank → crypto → card', group: 'ramp', badge: 'Verified',
      endpoint: '/api/vault/cardtopup/transak',
      verifiedAgainst: 'Order status fetched live from the Transak API; only COMPLETED orders are credited.',
      available: envSet('TRANSAK_API_KEY'),
      unavailableReason: envSet('TRANSAK_API_KEY') ? undefined : 'Requires TRANSAK_API_KEY to be set on this server.',
      provideToLoader: [
        'The destination wallet address for the on-ramp order — that is where Transak delivers the crypto.',
        'The exact amount and currency they are to pay.',
        'The request to send you the Transak order ID. The card is credited only when the Transak API reports that order COMPLETED.',
      ],
      fields: [
        { name: 'orderId', label: 'Transak order ID', type: 'text', required: true, placeholder: 'e.g. 6a1f…' },
        { name: 'amount', label: 'Amount', type: 'number', required: true, placeholder: '0.00' },
      ],
    },

    {
      id: 'cash', title: 'Cash deposit', subtitle: 'Handed over in person', group: 'cash', badge: 'Operator-confirmed',
      endpoint: '/api/vault/cardtopup/cash',
      verifiedAgainst: 'Credited only when an operator holding the vault operator code confirms the cash was received.',
      available: envSet('VAULT_CASH_OPERATOR_CODE'),
      unavailableReason: envSet('VAULT_CASH_OPERATOR_CODE') ? undefined : 'Requires VAULT_CASH_OPERATOR_CODE to be set on this server.',
      provideToLoader: [
        'The branch or desk where they hand the cash over.',
        'The exact amount and currency to hand over.',
        'The instruction to keep the receipt — its number becomes the deposit reference you record here.',
        'Nothing else is required: the operator who takes the cash credits the card with the vault operator code.',
      ],
      fields: [
        { name: 'amount', label: 'Amount', type: 'number', required: true, placeholder: '0.00' },
        { name: 'depositRef', label: 'Deposit reference', type: 'text', required: true, placeholder: 'e.g. CASH-0417' },
        { name: 'operatorId', label: 'Operator ID', type: 'text', required: true, placeholder: 'Who took the cash' },
        { name: 'location', label: 'Location', type: 'text', placeholder: 'Branch / desk' },
        { name: 'operatorCode', label: 'Operator code', type: 'password', required: true, placeholder: '••••••••' },
      ],
    },

    {
      id: 'card_to_card', title: 'Vault card → vault card', subtitle: 'Move balance between your cards', group: 'card', badge: 'Internal',
      endpoint: '/api/vault/cardtopup/card-to-card',
      verifiedAgainst: 'Debits the source vault card first, so the credit is always backed by a real balance already on the card.',
      available: true,
      provideToLoader: [
        'Nothing — both cards live inside this system. The source card is debited and the destination card credited in one atomic step, so no external party is involved.',
        'Nothing outside this system can fund a card here: an outside card must be captured through one of the verified rails above.',
      ],
      fields: [
        { name: 'sourceCardId', label: 'Source card', type: 'text', required: true, placeholder: 'e.g. eur' },
        { name: 'amount', label: 'Amount', type: 'number', required: true, placeholder: '0.00' },
        { name: 'sourceRef', label: 'Reference', type: 'text', required: true, placeholder: 'e.g. C2C-2201' },
      ],
    },
  ];
}

/**
 * GET /api/vault/cardtopup/methods
 * The full funding-method catalog. Each entry declares whether the rail is
 * actually usable on this server, so the UI never offers a method that would
 * fail verification.
 */
router.get('/methods', (_req: Request, res: Response) => {
  const methods = listFundingMethods();
  return res.json({
    ok: true,
    count: methods.length,
    availableCount: methods.filter((m) => m.available).length,
    methods,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 1 — BANK WIRE (SWIFT / SEPA / ACH)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/bank-wire
 * Body: {
 *   cardId, currency, amount,
 *   wireReference, senderName, senderBank,
 *   transferType: 'SWIFT'|'SEPA'|'ACH'|'FEDWIRE'|'FASTER_PAYMENTS'|'RTGS',
 *   operatorCode, note?
 * }
 */
router.post('/bank-wire', async (req: Request, res: Response) => {
  try {
    const { cardId, currency, amount, wireReference, senderName, senderBank,
            transferType, operatorCode, note } = req.body || {};

    if (!cardId || !currency || !amount || !wireReference || !senderName || !transferType || !operatorCode) {
      return res.status(400).json({ ok: false, error: 'cardId, currency, amount, wireReference, senderName, transferType and operatorCode are required' });
    }

    const result = await topupViaBankWire({
      cardId: String(cardId), currency: String(currency), amount: Number(amount),
      wireReference: String(wireReference), senderName: String(senderName),
      senderBank: String(senderBank || ''), transferType: String(transferType).toUpperCase() as any,
      operatorCode: String(operatorCode), note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

/**
 * POST /api/vault/cardtopup/bank-wire/confirm
 * Phase 2: an operator confirms the wire actually landed in the vault bank
 * account. Only this call credits the card.
 * Requires authentication + the vault operator code.
 * Body: { wireReference, operatorCode }
 */
router.post('/bank-wire/confirm', async (req: Request, res: Response) => {
  try {
    const { wireReference, operatorCode } = req.body || {};
    if (!wireReference || !operatorCode) {
      return res.status(400).json({ ok: false, error: 'wireReference and operatorCode are required' });
    }
    const result = await confirmBankWireTopup({
      wireReference: String(wireReference),
      operatorCode: String(operatorCode),
      confirmedBy: (req as any).user?.username ? String((req as any).user.username) : undefined,
    });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

/**
 * GET /api/vault/cardtopup/bank-wire/pending
 * Wires awaiting operator confirmation. Nothing here has been credited yet.
 */
router.get('/bank-wire/pending', async (_req: Request, res: Response) => {
  try {
    const wires = await listPendingBankWires();
    return res.json({ ok: true, count: wires.length, wires });
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 2 — WISE
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/wise
 * Body: { cardId, currency, amount, transferId, note? }
 */
router.post('/wise', async (req: Request, res: Response) => {
  try {
    const { cardId, currency, amount, transferId, note } = req.body || {};

    if (!cardId || !currency || !amount || !transferId) {
      return res.status(400).json({ ok: false, error: 'cardId, currency, amount and transferId are required' });
    }

    const result = await topupViaWise({
      cardId: String(cardId), currency: String(currency),
      amount: Number(amount), transferId: String(transferId),
      note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 3 — CRYPTO (USDT on-chain)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/crypto
 * Body: { cardId, currency, amount, txHash, network: 'tron'|'bsc'|'ethereum'|'polygon', note? }
 */
router.post('/crypto', async (req: Request, res: Response) => {
  try {
    const { cardId, currency, amount, txHash, network, note } = req.body || {};
    const validNetworks = ['tron', 'bsc', 'ethereum', 'polygon'];

    if (!cardId || !currency || !amount || !txHash || !validNetworks.includes(String(network))) {
      return res.status(400).json({ ok: false, error: `cardId, currency, amount, txHash and network (${validNetworks.join('|')}) are required` });
    }

    const result = await topupViaCrypto({
      cardId: String(cardId), currency: String(currency), amount: Number(amount),
      txHash: String(txHash), network: String(network) as any,
      note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 4 — TRANSAK (manual confirm)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/transak
 * Body: { cardId, currency, amount, orderId, note? }
 */
router.post('/transak', async (req: Request, res: Response) => {
  try {
    const { cardId, currency, amount, orderId, note } = req.body || {};

    if (!cardId || !currency || !amount || !orderId) {
      return res.status(400).json({ ok: false, error: 'cardId, currency, amount and orderId are required' });
    }

    const result = await topupViaTransak({
      cardId: String(cardId), currency: String(currency),
      amount: Number(amount), orderId: String(orderId),
      note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 5 — CASH DEPOSIT
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/cash
 * Body: { cardId, currency, amount, depositRef, operatorId, operatorCode, location?, note? }
 */
router.post('/cash', async (req: Request, res: Response) => {
  try {
    const { cardId, currency, amount, depositRef, operatorId, operatorCode, location, note } = req.body || {};

    if (!cardId || !currency || !amount || !depositRef || !operatorId || !operatorCode) {
      return res.status(400).json({ ok: false, error: 'cardId, currency, amount, depositRef, operatorId and operatorCode are required' });
    }

    const result = await topupViaCash({
      cardId: String(cardId), currency: String(currency), amount: Number(amount),
      depositRef: String(depositRef), operatorId: String(operatorId),
      operatorCode: String(operatorCode), location: location ? String(location) : undefined,
      note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL 6 — CARD TO CARD
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/card-to-card
 * Body: { sourceCardId, destCardId, currency, amount, sourceRef, operatorCode?, note? }
 * Use sourceCardId='EXTERNAL' for loading from an external confirmed card.
 */
router.post('/card-to-card', async (req: Request, res: Response) => {
  try {
    const { sourceCardId, destCardId, currency, amount, sourceRef, operatorCode, note } = req.body || {};

    if (!sourceCardId || !destCardId || !currency || !amount || !sourceRef) {
      return res.status(400).json({ ok: false, error: 'sourceCardId, destCardId, currency, amount and sourceRef are required' });
    }
    if (String(sourceCardId) === String(destCardId)) {
      return res.status(400).json({ ok: false, error: 'sourceCardId and destCardId must be different' });
    }

    const result = await topupViaCardToCard({
      sourceCardId: String(sourceCardId), destCardId: String(destCardId),
      currency: String(currency), amount: Number(amount),
      sourceRef: String(sourceRef),
      operatorCode: operatorCode ? String(operatorCode) : undefined,
      note: note ? String(note) : undefined,
    });

    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err: any) {
    return handleErr(res, err);
  }
});

export { router as cardTopupRouter };
