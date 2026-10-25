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
  topupViaCrypto,
  topupViaTransak,
  topupViaCash,
  topupViaCardToCard,
  handleTransakTopupWebhook,
} from './cardTopup.service';
import {
  creditCard,
  getCardBalance,
  getCardHistory,
  listAllCardBalances,
} from './cardBalance.service';
import { findCryptoCard, verifyIncoming } from './cryptoCards.service';
import { db } from '../../config/db';

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
  /** Where the money must be sent — ready to hand over, one entry per receiving account. */
  receiving?: LoaderAccount[];
  /** Why there is nothing to hand over, or what to configure to get it. */
  receivingNote?: string;
  fields:     FundingField[];
}

/** One copyable line of the receiving instruction handed to the loader. */
export interface LoaderDetail {
  label: string;
  value: string;
  /** Render monospaced — account numbers, IBANs, wallet addresses, hashes. */
  mono?: boolean;
}

/** Where the money must be sent. A rail can offer several (one per currency/network). */
export interface LoaderAccount {
  title: string;
  rows: LoaderDetail[];
}

/** A row of the `bank_accounts` table owned by the merchant. */
export interface BankAccountRow {
  bank_name?: string | null;      account_holder?: string | null; account_number?: string | null;
  routing_number?: string | null; iban?: string | null;           swift_code?: string | null;
  bank_address?: string | null;   currency?: string | null;       is_default?: number | null;
}

const envSet = (k: string) => Boolean((process.env[k] || '').trim());

/** Human-readable network names for the loader checklist. */
const NETWORK_LABEL: Record<string, string> = {
  tron: 'TRON (TRC-20)',
  bitcoin: 'Bitcoin',
};

/** The vault's USDT deposit address per network — shown to the loader verbatim. */
const USDT_DEPOSIT_ADDRESS: Record<string, string> = {
  tron:     (process.env.VAULT_USDT_TRON_ADDRESS || '').trim(),
  ethereum: (process.env.VAULT_USDT_ETHEREUM_ADDRESS || '').trim(),
  bsc:      (process.env.VAULT_USDT_BSC_ADDRESS || '').trim(),
  polygon:  (process.env.VAULT_USDT_POLYGON_ADDRESS || '').trim(),
};

/** The TRC-20 USDT contract the TRON card receives on. */
const TRON_USDT_CONTRACT = (process.env.VAULT_USDT_TRON_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t').trim();

/** The vault's Bitcoin receiving address (BIP-84 native SegWit). */
const BTC_DEPOSIT_ADDRESS = (process.env.VAULT_BTC_ADDRESS || '').trim();

/** Which currency a wire rail can receive into. null = any currency. */
const WIRE_CURRENCY: Record<string, string | null> = {
  SWIFT: null, SEPA: 'EUR', ACH: 'USD', FEDWIRE: 'USD', RTGS: 'USD', FASTER_PAYMENTS: 'GBP',
};

/** Turn a merchant bank account row into the copyable lines the loader needs. */
function accountDetailRows(a: BankAccountRow): LoaderDetail[] {
  const rows: LoaderDetail[] = [];
  const push = (label: string, value: unknown, mono = false) => {
    const v = value === null || value === undefined ? '' : String(value).trim();
    if (v) rows.push({ label, value: v, mono });
  };
  push('Account holder', a.account_holder);
  push('Bank name', a.bank_name);
  push('IBAN', a.iban, true);
  push('Account number', a.account_number, true);
  push('SWIFT / BIC', a.swift_code, true);
  push('Routing / ABA', a.routing_number, true);
  push('Bank address', a.bank_address);
  push('Currency', a.currency);
  return rows;
}

const accountTitle = (a: BankAccountRow): string =>
  `${a.bank_name || 'Vault account'} · ${String(a.currency || '').toUpperCase() || '—'}${a.is_default ? ' · default' : ''}`;

const toLoaderAccounts = (rows: BankAccountRow[]): LoaderAccount[] =>
  rows.map((a) => ({ title: accountTitle(a), rows: accountDetailRows(a) })).filter((acct) => acct.rows.length > 0);

/**
 * The company's own receiving accounts, configured once in the environment as
 * VAULT_RECEIVE_<CCY>_*. They belong to Primestack rather than to a merchant, so
 * they are not stored per merchant — but the loader sheet still has to print
 * the real IBAN / account number, never a description of which details to send.
 */
function envReceiveAccounts(): BankAccountRow[] {
  const currencies = new Set<string>();
  for (const key of Object.keys(process.env)) {
    const match = /^VAULT_RECEIVE_([A-Z]{3})_/.exec(key);
    if (match) currencies.add(match[1]);
  }
  const accounts: BankAccountRow[] = [];
  for (const currency of currencies) {
    const get = (suffix: string) => (process.env[`VAULT_RECEIVE_${currency}_${suffix}`] || '').trim();
    const accountHolder = get('ACCOUNT_HOLDER');
    if (!accountHolder) continue;
    accounts.push({
      bank_name: get('BANK') || '',
      account_holder: accountHolder,
      account_number: get('ACCOUNT') || get('ACCOUNT_NUMBER'),
      routing_number: get('ROUTING'),
      iban: get('IBAN'),
      swift_code: get('SWIFT') || get('BIC'),
      bank_address: get('BANK_ADDRESS'),
      currency,
      is_default: 0,
    });
  }
  return accounts;
}

/** Accounts registered for the merchant win per currency; the env ones fill the rest. */
export function receivingAccounts(merchantRows: BankAccountRow[]): BankAccountRow[] {
  const covered = new Set(merchantRows.map((a) => String(a.currency || '').toUpperCase()));
  const extra = envReceiveAccounts().filter((a) => !covered.has(String(a.currency || '').toUpperCase()));
  return [...merchantRows, ...extra];
}

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
export function listFundingMethods(bankAccounts: BankAccountRow[] = []): FundingMethod[] {
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
    const wanted = WIRE_CURRENCY[transferType] ?? null;
    const receiving = toLoaderAccounts(
      bankAccounts.filter((a) => !wanted || String(a.currency || '').toUpperCase() === wanted),
    );
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
      receiving,
      receivingNote: receiving.length
        ? undefined
        : `No ${wanted ? `${wanted} ` : ''}receiving account is registered for this merchant yet — add it under Bank accounts so the loader has somewhere to send.`,
      fixed, fields: WIRE_FIELDS(),
    };
  };

  const crypto = (cfg: {
    id: string; title: string; subtitle: string;
    networkLabel: string; networkKey: 'tron' | 'bitcoin';
    asset: string; address: string; contract?: string;
    available: boolean; unavailableReason?: string;
    verifiedAgainst: string; txPlaceholder: string;
  }): FundingMethod => {
    const receiving: LoaderAccount[] = cfg.address
      ? [{
          title: `${cfg.networkLabel} deposit address`,
          rows: [
            { label: 'Network', value: cfg.networkLabel },
            { label: 'Asset', value: cfg.asset, mono: true },
            ...(cfg.contract ? [{ label: 'Token contract', value: cfg.contract, mono: true }] : []),
            { label: 'Deposit address', value: cfg.address, mono: true },
          ],
        }]
      : [];
    return {
      id: cfg.id, title: cfg.title, subtitle: cfg.subtitle, group: 'crypto', badge: 'Verified',
      endpoint: '/api/vault/cardtopup/crypto',
      verifiedAgainst: cfg.verifiedAgainst,
      available: cfg.available,
      unavailableReason: cfg.available ? undefined : cfg.unavailableReason,
      provideToLoader: [
        `The ${cfg.asset} deposit address on ${cfg.networkLabel} — this exact address, on this exact network.`,
        `The exact ${cfg.asset} amount to send. A mismatched amount is refused.`,
        `The warning to send ${cfg.asset} on ${cfg.networkLabel} only — another token or network is refused.`,
        'The request to send you the transaction hash once the transfer confirms.',
      ],
      receiving,
      receivingNote: receiving.length ? undefined : cfg.unavailableReason,
      fixed: { network: cfg.networkKey },
      fields: [
        { name: 'txHash', label: 'Transaction hash', type: 'text', required: true, placeholder: cfg.txPlaceholder },
        { name: 'amount', label: `Amount (${cfg.asset})`, type: 'number', required: true, placeholder: '0.00' },
      ],
    };
  };

  const transakAddress = (process.env.VAULT_TRANSAK_WALLET_ADDRESS || '').trim();
  const cashBranch = (process.env.VAULT_CASH_BRANCH || '').trim();

  return [
    wire('wire_swift', 'SWIFT international wire', 'Cross-border, any currency', { transferType: 'SWIFT' }),
    wire('wire_sepa', 'SEPA transfer', 'EUR zone', { transferType: 'SEPA' }),
    wire('wire_ach', 'ACH transfer', 'USD domestic', { transferType: 'ACH' }),
    wire('wire_fedwire', 'Fedwire / RTGS', 'High-value USD / ZAR', { transferType: 'FEDWIRE' }),
    wire('wire_faster', 'Faster Payments', 'GBP domestic', { transferType: 'FASTER_PAYMENTS' }),

    crypto({
      id: 'usdt_tron', title: 'USDT — TRON (TRC-20)', subtitle: 'TRC-20 deposit',
      networkLabel: NETWORK_LABEL.tron, networkKey: 'tron', asset: 'USDT',
      address: USDT_DEPOSIT_ADDRESS.tron, contract: TRON_USDT_CONTRACT,
      available: Boolean(USDT_DEPOSIT_ADDRESS.tron) && envSet('TRON_API_KEY'),
      unavailableReason: USDT_DEPOSIT_ADDRESS.tron
        ? 'Requires TRON_API_KEY to be set on this server.'
        : 'Set VAULT_USDT_TRON_ADDRESS to show the deposit address here.',
      verifiedAgainst: 'Transaction looked up on TronGrid; a reverted transfer, or a USDT amount that does not match the amount you enter, is refused.',
      txPlaceholder: 'TRON tx id',
    }),

    crypto({
      id: 'crypto_btc', title: 'BTC — Bitcoin', subtitle: 'Bitcoin network deposit',
      networkLabel: NETWORK_LABEL.bitcoin, networkKey: 'bitcoin', asset: 'BTC',
      address: BTC_DEPOSIT_ADDRESS,
      available: Boolean(BTC_DEPOSIT_ADDRESS),
      unavailableReason: 'Set VAULT_BTC_ADDRESS to show the deposit address here.',
      verifiedAgainst: 'Transaction looked up on mempool.space; only a confirmed transaction that pays this card’s Bitcoin address the exact amount is accepted.',
      txPlaceholder: 'Bitcoin txid',
    }),

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
      receiving: transakAddress
        ? [{ title: 'On-ramp destination', rows: [{ label: 'Destination wallet address', value: transakAddress, mono: true }] }]
        : [],
      receivingNote: transakAddress
        ? undefined
        : 'Set VAULT_TRANSAK_WALLET_ADDRESS to show the destination address here.',
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
      receiving: cashBranch
        ? [{ title: 'Cash deposit point', rows: [{ label: 'Branch / desk', value: cashBranch }] }]
        : [],
      receivingNote: cashBranch
        ? undefined
        : 'Set VAULT_CASH_BRANCH to show the deposit location here.',
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
      receiving: [],
      receivingNote: 'Nothing external — both cards are inside this system, so there is no account to send to.',
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
router.get('/methods', async (_req: Request, res: Response) => {
  // The receiving details handed to a loader are this merchant's own bank
  // accounts, so the catalog is built from live configuration + real rows.
  let bankAccounts: BankAccountRow[] = [];
  try {
    const merchantId = process.env.PROCESSOR_MERCHANT_ID?.trim() || 'MRC-1001';
    const result = await db.query(
      `SELECT bank_name, account_holder, account_number, routing_number, iban,
              swift_code, bank_address, currency, is_default
         FROM bank_accounts
        WHERE merchant_id = ?
        ORDER BY is_default DESC, currency ASC`,
      [merchantId],
    );
    bankAccounts = result.rows as unknown as BankAccountRow[];
  } catch {
    // The catalog is still useful without receiving details.
  }

  const methods = listFundingMethods(receivingAccounts(bankAccounts));
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
// CHANNEL 3 — CRYPTO (USDT on-chain)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * POST /api/card-topup/crypto
 * Body: { cardId, currency, amount, txHash, network: 'tron'|'bitcoin', note? }
 */
router.post('/crypto', async (req: Request, res: Response) => {
  try {
    const { cardId, currency, amount, txHash, network, note } = req.body || {};
    const validNetworks = ['tron', 'bitcoin'];

    if (!cardId || !currency || !amount || !txHash || !validNetworks.includes(String(network))) {
      return res.status(400).json({ ok: false, error: `cardId, currency, amount, txHash and network (${validNetworks.join('|')}) are required` });
    }

    // Bitcoin has no scanner API — the transaction is read straight from the
    // Bitcoin network through mempool.space and must pay the vault BTC address.
    if (String(network) === 'bitcoin') {
      const btcCard = findCryptoCard('btc');
      if (!btcCard) {
        return res.status(500).json({ ok: false, error: 'Bitcoin card is not configured on this server' });
      }

      const check = await verifyIncoming(btcCard, String(txHash), Number(amount));
      if (!check.ok) {
        return res.status(400).json({ ok: false, channel: 'crypto', cardId: String(cardId), error: check.error });
      }

      const txn = await creditCard(
        String(cardId), String(currency), Number(amount),
        'crypto', String(txHash), 'bitcoin',
        note ? String(note) : `Confirmed BTC on-chain deposit ${String(txHash).slice(0, 12)}…`,
      );

      return res.json({
        ok: true, channel: 'crypto', cardId: String(cardId), currency: String(currency).toUpperCase(),
        amount: Number(amount), providerRef: String(txHash), balanceAfter: txn.balanceAfter,
        message: `Credited ${amount} ${String(currency).toUpperCase()} from a confirmed Bitcoin transaction.`,
        txnId: txn.id, status: 'CONFIRMED',
      });
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
