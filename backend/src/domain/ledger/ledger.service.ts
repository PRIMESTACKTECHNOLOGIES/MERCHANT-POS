export type TransactionState = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'SETTLED' | 'REVERSED' | 'FAILED';

export type EntryType = 'credit' | 'debit';

export interface LedgerEntry {
  id: string;
  transactionId: string;
  type: EntryType;
  amount: number;
  amountMinor: number;
  currency: string;
  status: TransactionState;
  description: string;
  createdAt: string;
  fxRateToFiat?: number;
  fiatCurrency?: string;
  walletRef?: string;
}

export interface FiatLedgerView {
  amountMinor: number;
  amountFloat: number;
  currency: string;
  entryCount: number;
  breakdown: { currency: string; originalMinor: number; convertedMinor: number; entries: number }[];
}

const FIXED_SCALE = 8;
const MINOR_UNIT = 100;

function padScale(n: number, scale: number = FIXED_SCALE): bigint {
  const s = Number(n).toFixed(scale);
  const stripped = s.replace('.', '');
  return BigInt(stripped.replace(/^(-?)0+(?!$)/, '$1') || '0');
}

function unpadScale(b: bigint, scale: number = FIXED_SCALE, asMinor: boolean = false): number {
  const divisor = asMinor ? BigInt(Math.pow(10, scale - 2)) : BigInt(Math.pow(10, scale));
  const sign = b < 0n ? '-' : '';
  const abs = b < 0n ? -b : b;
  const whole = abs / divisor;
  const frac = abs % divisor;
  const fracStr = frac.toString().padStart(scale, '0').slice(0, asMinor ? 2 : scale);
  const result = Number(`${sign}${whole}.${fracStr}`);
  return asMinor ? Math.round(result) : result;
}

const BASE_FX_RATES: Record<string, Record<string, number>> = {
  USD: { USD: 1, AED: 0.272294, EUR: 1.0892, GBP: 1.2714, SAR: 0.266657, INR: 0.012003, JPY: 0.006552 },
  AED: { AED: 1, USD: 3.6725, EUR: 3.9982, GBP: 4.6681, SAR: 0.9793, INR: 0.04407, JPY: 0.02405 },
  EUR: { EUR: 1, USD: 0.9182, AED: 0.2501, GBP: 1.1669, SAR: 0.2447, INR: 0.01102, JPY: 0.00601 },
  GBP: { GBP: 1, USD: 0.7865, AED: 0.2142, EUR: 0.8569, SAR: 0.2097, INR: 0.00944, JPY: 0.00515 },
  SAR: { SAR: 1, USD: 3.7501, AED: 1.0211, EUR: 4.0864, GBP: 4.7684, INR: 0.0450, JPY: 0.02457 },
  INR: { INR: 1, USD: 83.31, AED: 22.69, EUR: 90.74, GBP: 105.93, SAR: 22.22, JPY: 0.546 },
  JPY: { JPY: 1, USD: 152.62, AED: 41.57, EUR: 166.39, GBP: 194.05, SAR: 40.69, INR: 1.830 },
};

export function getFxRate(sourceCurrency: string, targetFiatCurrency: string): number {
  const src = String(sourceCurrency || 'USD').toUpperCase();
  const tgt = String(targetFiatCurrency || 'USD').toUpperCase();
  if (src === tgt) return 1;
  const direct = BASE_FX_RATES[src]?.[tgt];
  if (direct && isFinite(direct) && direct > 0) return direct;
  const viaUsdSrc = BASE_FX_RATES[src]?.['USD'];
  const viaUsdTgt = BASE_FX_RATES[tgt]?.['USD'];
  if (viaUsdSrc && viaUsdTgt && viaUsdTgt > 0) {
    const derived = viaUsdSrc / viaUsdTgt;
    if (isFinite(derived) && derived > 0) return derived;
  }
  const usdToTgt = BASE_FX_RATES['USD']?.[tgt];
  if (usdToTgt && isFinite(usdToTgt) && usdToTgt > 0) return usdToTgt;
  console.warn(`[FX] Missing rate ${src}->${tgt}; falling back to 1.0`);
  return 1;
}

export function setFxRateOverride(sourceCurrency: string, targetFiatCurrency: string, rate: number): void {
  const src = String(sourceCurrency || 'USD').toUpperCase();
  const tgt = String(targetFiatCurrency || 'USD').toUpperCase();
  if (!BASE_FX_RATES[src]) BASE_FX_RATES[src] = {};
  BASE_FX_RATES[src][tgt] = Number(rate);
}

const allowedTransitions: Record<TransactionState, TransactionState[]> = {
  PENDING: ['AUTHORIZED', 'FAILED'],
  AUTHORIZED: ['CAPTURED', 'REVERSED', 'FAILED'],
  CAPTURED: ['SETTLED', 'REVERSED', 'FAILED'],
  SETTLED: ['REVERSED'],
  REVERSED: [],
  FAILED: [],
};

export function validateTransition(current: TransactionState, next: TransactionState): void {
  if (current === next) return;
  if (!allowedTransitions[current]?.includes(next)) {
    throw new Error(`Invalid transition from ${current} to ${next}`);
  }
}

export interface CreateLedgerEntryOpts {
  fxRateToFiat?: number;
  fiatCurrency?: string;
  walletRef?: string;
}

export function createLedgerEntry(
  transactionId: string,
  type: EntryType,
  amount: number,
  currency: string,
  status: TransactionState,
  description: string,
  opts?: CreateLedgerEntryOpts
): LedgerEntry {
  const fiatCcy = String(opts?.fiatCurrency || 'USD').toUpperCase();
  const ccy = String(currency || 'USD').toUpperCase();
  const rate = opts?.fxRateToFiat && isFinite(Number(opts.fxRateToFiat)) && Number(opts.fxRateToFiat) > 0
    ? Number(opts.fxRateToFiat)
    : getFxRate(ccy, fiatCcy);
  const amtNum = Number(amount || 0);
  return {
    id: `ledger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    transactionId,
    type,
    amount: amtNum,
    amountMinor: Math.round(amtNum * MINOR_UNIT),
    currency: ccy,
    status,
    description,
    createdAt: new Date().toISOString(),
    fxRateToFiat: rate,
    fiatCurrency: fiatCcy,
    walletRef: opts?.walletRef || undefined,
  };
}

export async function ensureLedgerFiatSchema(query: (text: string, params?: any[]) => Promise<any>): Promise<void> {
  try { await query(`ALTER TABLE ledger_entries ADD COLUMN amount_minor INTEGER`); } catch { /* ignore */ }
  try { await query(`ALTER TABLE ledger_entries ADD COLUMN fx_rate_to_fiat REAL`); } catch { /* ignore */ }
  try { await query(`ALTER TABLE ledger_entries ADD COLUMN fiat_currency TEXT DEFAULT 'USD'`); } catch { /* ignore */ }
  try { await query(`ALTER TABLE ledger_entries ADD COLUMN wallet_ref TEXT`); } catch { /* ignore */ }
}

export async function persistLedgerEntry(
  entry: LedgerEntry,
  query: (text: string, params?: any[]) => Promise<any> = async () => { throw new Error('No query function provided'); }
): Promise<void> {
  await ensureLedgerFiatSchema(query);
  await query(
    `INSERT INTO ledger_entries
       (id, transaction_id, type, amount, amount_minor, currency, status, description, created_at, fx_rate_to_fiat, fiat_currency, wallet_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.id,
      entry.transactionId,
      entry.type,
      entry.amount,
      entry.amountMinor ?? Math.round(Number(entry.amount || 0) * MINOR_UNIT),
      entry.currency,
      entry.status,
      entry.description,
      entry.createdAt,
      entry.fxRateToFiat ?? null,
      entry.fiatCurrency ?? 'USD',
      entry.walletRef ?? null,
    ]
  );
}

export function convertLedgerToFiatBalance(entries: LedgerEntry[], fiatCurrency: string = 'USD'): FiatLedgerView {
  const tgt = String(fiatCurrency || 'USD').toUpperCase();
  let totalMinor = 0n;
  const bucket = new Map<string, { originalMinor: number; convertedMinor: number; entries: number }>();

  for (const entry of entries) {
    const src = String(entry.currency || 'USD').toUpperCase();
    const signedMinor = BigInt(Math.round(Number(entry.amountMinor ?? (Number(entry.amount || 0) * MINOR_UNIT))))
      * (entry.type === 'credit' ? 1n : -1n);

    let rateToTgt: number;
    if (entry.fiatCurrency && entry.fxRateToFiat && isFinite(Number(entry.fxRateToFiat)) && entry.fxRateToFiat > 0) {
      const entryFiat = String(entry.fiatCurrency).toUpperCase();
      if (entryFiat === tgt) {
        rateToTgt = Number(entry.fxRateToFiat);
      } else {
        const cross = getFxRate(entryFiat, tgt);
        rateToTgt = Number(entry.fxRateToFiat) * cross;
      }
    } else {
      rateToTgt = getFxRate(src, tgt);
    }

    const rateScaled = padScale(rateToTgt, FIXED_SCALE);
    const convertedScaled = signedMinor * rateScaled;
    const convertedMinor = unpadScale(convertedScaled, FIXED_SCALE, true);

    totalMinor += BigInt(convertedMinor);

    const b = bucket.get(src) || { originalMinor: 0, convertedMinor: 0, entries: 0 };
    b.originalMinor += Number(signedMinor);
    b.convertedMinor += Number(convertedMinor);
    b.entries += 1;
    bucket.set(src, b);
  }

  const breakdown: FiatLedgerView['breakdown'] = [];
  bucket.forEach((v, k) => {
    breakdown.push({
      currency: k,
      originalMinor: v.originalMinor,
      convertedMinor: v.convertedMinor,
      entries: v.entries,
    });
  });
  breakdown.sort((a, b) => Math.abs(b.convertedMinor) - Math.abs(a.convertedMinor));

  const totalFloat = Number(totalMinor) / MINOR_UNIT;
  return {
    amountMinor: Number(totalMinor),
    amountFloat: totalFloat,
    currency: tgt,
    entryCount: entries.length,
    breakdown,
  };
}

export function formatFiatMinor(amountMinor: number, currency: string = 'USD'): string {
  const neg = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const whole = Math.floor(abs / MINOR_UNIT);
  const frac = abs % MINOR_UNIT;
  const fracStr = frac.toString().padStart(2, '0');
  const symbolMap: Record<string, string> = { USD: '$', AED: 'د.إ', EUR: '€', GBP: '£', SAR: '﷼', INR: '₹', JPY: '¥' };
  const sym = symbolMap[currency?.toUpperCase()] || '';
  return `${neg ? '-' : ''}${sym}${whole.toLocaleString('en-US')}.${fracStr}`;
}
