import { VaultBankAcquirerClient } from '../payments/acquirer/vault-bank-acquirer.client';
import { getVaultCardById, type VaultCard } from './vaultCardService';
import { VAULT_BINS } from './vaultBin';
import { luhnValidate } from './luhn';
import { v4 as uuidv4 } from 'uuid';

export interface VaultCardNetworkAuthParams {
  vaultCardId?: string;
  vaultAccountId?: string;
  cardNumber?: string;
  expiry?: string;
  cvv?: string;
  amountMinor: number;
  currency: string;
  merchantAccount?: string;
  terminalId?: string;
  forceStandIn?: boolean;
}

export interface VaultCardNetworkAuthResult {
  success: boolean;
  mti: string;
  responseCode: string;
  status: 'Approved' | 'Declined' | 'Referral' | 'PartialApproval' | 'NetworkError';
  scheme: 'VISA' | 'MASTERCARD' | string;
  bin: string;
  last4: string;
  approvalCode: string;
  retrievalReferenceNumber: string;
  stan: string;
  networkReference: string;
  acquirerMessage: string;
  raw?: any;
}

const NUM_CCY_TO_ALPHA: Record<string, string> = {
  '784': 'AED', '840': 'USD', '978': 'EUR', '826': 'GBP',
  '702': 'SGD', '356': 'INR', '392': 'JPY', '756': 'CHF',
  '036': 'AUD', '124': 'CAD', '344': 'HKD', '458': 'MYR',
};

const vaultAcquirer = new VaultBankAcquirerClient();

function detectSchemeFromBin(bin6: string): 'VISA' | 'MASTERCARD' | string {
  for (const key in VAULT_BINS) {
    if (VAULT_BINS[key].bin === bin6) return VAULT_BINS[key].scheme;
  }
  const d = bin6.charAt(0);
  if (d === '4') return 'VISA';
  if (d === '5') return 'MASTERCARD';
  return 'UNKNOWN';
}

export async function generateVaultCardNetworkAuth(
  params: VaultCardNetworkAuthParams,
): Promise<VaultCardNetworkAuthResult> {
  const {
    amountMinor,
    currency,
    merchantAccount = 'VAULT-SETTLEMENT-MID',
    terminalId = 'VAULT-T2013-001',
  } = params;

  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw Object.assign(new Error('AMOUNT_MUST_BE_POSITIVE_MINOR_UNITS'), {
      code: 'AMOUNT_MUST_BE_POSITIVE_MINOR_UNITS',
    });
  }
  if (!/^[A-Z]{3}$/.test(currency?.toUpperCase() || '')) {
    throw Object.assign(new Error('INVALID_CURRENCY'), { code: 'INVALID_CURRENCY' });
  }

  let card: Partial<VaultCard> = {};
  let cardNumber: string;
  let expiry: string | undefined;
  let cvv: string | undefined;

  if (params.vaultCardId) {
    const loaded = await getVaultCardById(params.vaultCardId);
    if (!loaded) {
      throw Object.assign(new Error('VAULT_CARD_NOT_FOUND'), { code: 'VAULT_CARD_NOT_FOUND' });
    }
    if (loaded.status !== 'ACTIVE') {
      throw Object.assign(new Error('VAULT_CARD_NOT_ACTIVE'), { code: 'VAULT_CARD_NOT_ACTIVE' });
    }
    card = loaded;
    cardNumber = loaded.card_number;
    expiry = loaded.expiry;
    cvv = loaded.cvv;
  } else if (params.cardNumber) {
    cardNumber = params.cardNumber.replace(/\D/g, '');
    expiry = params.expiry;
    cvv = params.cvv;
    if (!luhnValidate(cardNumber)) {
      throw Object.assign(new Error('LUHN_CHECK_FAILED'), { code: 'LUHN_CHECK_FAILED' });
    }
  } else {
    throw Object.assign(new Error('VAULT_CARD_OR_ID_REQUIRED'), {
      code: 'VAULT_CARD_OR_ID_REQUIRED',
    });
  }

  const bin6 = cardNumber.slice(0, 6);
  const last4 = cardNumber.slice(-4);
  const scheme = card.scheme || detectSchemeFromBin(bin6);
  const stan = String(Math.floor(Math.random() * 900000 + 100000));

  try {
    const authResponse = await vaultAcquirer.authorize({
      merchantAccount,
      amountMinor,
      currency: currency.toUpperCase(),
      cardNumber,
      expiry,
      cvv: cvv ?? null,
      processingCode: '000000',
      stan,
      protocol: '101.1',
    });

    const approvalCode = authResponse.approvalCode || '';
    const rrn = authResponse.authRef || '';
    const schemeUpper = scheme.toUpperCase().slice(0, 2);
    const tsHex = Date.now().toString(36).toUpperCase();
    const networkReference = `${schemeUpper}-${approvalCode || '000000'}-${rrn.slice(-6) || tsHex}`;

    return {
      success: authResponse.success,
      mti: authResponse.responseCode === '91' ? '0100' : '0110',
      responseCode: authResponse.responseCode,
      status: (authResponse.status as any) === 'Approved' ? 'Approved'
            : (authResponse.status as any) === 'Referral' ? 'Referral'
            : (authResponse.status as any) === 'PartialApproval' ? 'PartialApproval'
            : authResponse.success ? 'Approved' : 'Declined',
      scheme,
      bin: bin6,
      last4,
      approvalCode,
      retrievalReferenceNumber: rrn,
      stan,
      networkReference,
      acquirerMessage: authResponse.message || (authResponse.success ? 'Network approved' : 'Network declined'),
      raw: authResponse,
    };
  } catch (err: any) {
    const schemeUpper = scheme.toUpperCase().slice(0, 2);
    return {
      success: false,
      mti: '0100',
      responseCode: '96',
      status: 'NetworkError',
      scheme,
      bin: bin6,
      last4,
      approvalCode: '',
      retrievalReferenceNumber: '',
      stan,
      networkReference: `${schemeUpper}-NTWKERR-${Date.now().toString(36).toUpperCase()}`,
      acquirerMessage: err?.message || 'Vault bank acquirer network call failed',
      raw: { error: err?.message || String(err) },
    };
  }
}

export async function generateVaultCardNetworkCodes(
  cardNumber: string,
  expiry: string,
  cvv: string,
  amountMinor: number,
  currency: string,
  opts: { merchantAccount?: string; terminalId?: string } = {},
): Promise<VaultCardNetworkAuthResult> {
  return generateVaultCardNetworkAuth({
    cardNumber,
    expiry,
    cvv,
    amountMinor,
    currency,
    merchantAccount: opts.merchantAccount,
    terminalId: opts.terminalId,
  });
}

export function buildVaultCardNetworkRef(params: {
  scheme: string;
  approvalCode?: string;
  rrn?: string;
  stan?: string;
}): string {
  const schemeUpper = (params.scheme || 'VISA').toUpperCase().slice(0, 2);
  const approval = (params.approvalCode || '000000').padEnd(6, '0').slice(0, 6);
  const rrnPart = (params.rrn || uuidv4().replace(/-/g, '')).slice(-8);
  const stanPart = (params.stan || String(Math.floor(Math.random() * 900000 + 100000))).slice(-6);
  return `${schemeUpper}${approval}${rrnPart}${stanPart}`;
}
