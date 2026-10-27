import type { BrandScheme, ProductType } from './brand';

export interface BinRange {
  bin: string;
  scheme: BrandScheme;
  product: ProductType;
  country: string;
  currency?: string;
  testCard?: boolean;
  description?: string;
}

export const BIN_RANGES: BinRange[] = [
  { bin: '412345', scheme: 'VISA', product: 'DEBIT', country: 'AE', testCard: true, description: 'Visa Test Debit UAE' },
  { bin: '423456', scheme: 'VISA', product: 'PREPAID', country: 'AE', testCard: true, description: 'Visa Test Prepaid UAE' },
  { bin: '532345', scheme: 'MASTERCARD', product: 'DEBIT', country: 'AE', testCard: true, description: 'Mastercard Test Debit UAE' },

  { bin: '476173', scheme: 'VISA', product: 'CREDIT', country: 'US', testCard: true, description: 'Visa Acquirer Test Card 01 VSDC CVN10' },
  { bin: '4761739001', scheme: 'VISA', product: 'CREDIT', country: 'US', testCard: true, description: 'Visa ADVT Card 01' },
  { bin: '4761739001010', scheme: 'VISA', product: 'CREDIT', country: 'US', testCard: true, description: 'Visa ADVT Card 01 Full PAN' },

  { bin: '621094', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN', testCard: true, description: 'UnionPay QuickPass Test QPC1' },
  { bin: '621094588801', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN', testCard: true, description: 'UnionPay QPC1 16dig RMB PIN+Sign' },
  { bin: '6210945888021', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN', testCard: true, description: 'UnionPay QPC2 13dig ODA PIN+Sign' },
  { bin: '621094588803', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN', testCard: true, description: 'UnionPay QPC3 16dig Sign Only' },

  { bin: '4', scheme: 'VISA', product: 'CREDIT', country: 'US' },
  { bin: '51', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '52', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '53', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '54', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '55', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '2221', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '2222', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '2223', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '2224', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '2225', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '2226', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '2227', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '2228', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '2229', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '223', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '224', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '225', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '226', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '227', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '228', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '229', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '23', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '24', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '25', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '26', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '270', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '271', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },
  { bin: '2720', scheme: 'MASTERCARD', product: 'CREDIT', country: 'US' },

  { bin: '62', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN' },
  { bin: '621', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN' },
  { bin: '622', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN' },
  { bin: '623', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN' },
  { bin: '624', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN' },
  { bin: '625', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN' },
  { bin: '626', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN' },
  { bin: '628', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN' },
  { bin: '629', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN' },
  { bin: '81', scheme: 'UNIONPAY', product: 'DEBIT', country: 'CN', testCard: true, description: 'UnionPay 81 BIN Test Card' },

  { bin: '34', scheme: 'AMEX', product: 'CREDIT', country: 'US' },
  { bin: '37', scheme: 'AMEX', product: 'CREDIT', country: 'US' },

  { bin: '300', scheme: 'DINERS', product: 'CREDIT', country: 'US' },
  { bin: '301', scheme: 'DINERS', product: 'CREDIT', country: 'US' },
  { bin: '302', scheme: 'DINERS', product: 'CREDIT', country: 'US' },
  { bin: '303', scheme: 'DINERS', product: 'CREDIT', country: 'US' },
  { bin: '304', scheme: 'DINERS', product: 'CREDIT', country: 'US' },
  { bin: '305', scheme: 'DINERS', product: 'CREDIT', country: 'US' },
  { bin: '36', scheme: 'DINERS', product: 'CREDIT', country: 'US' },
  { bin: '38', scheme: 'DINERS', product: 'CREDIT', country: 'US' },

  { bin: '352', scheme: 'JCB', product: 'CREDIT', country: 'JP' },
  { bin: '353', scheme: 'JCB', product: 'CREDIT', country: 'JP' },
  { bin: '354', scheme: 'JCB', product: 'CREDIT', country: 'JP' },
  { bin: '355', scheme: 'JCB', product: 'CREDIT', country: 'JP' },
  { bin: '356', scheme: 'JCB', product: 'CREDIT', country: 'JP' },
  { bin: '357', scheme: 'JCB', product: 'CREDIT', country: 'JP' },
  { bin: '358', scheme: 'JCB', product: 'CREDIT', country: 'JP' },

  { bin: '6011', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '622126', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '622127', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '622128', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '622129', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62213', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62214', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62215', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62216', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62217', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62218', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62219', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '6222', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '6223', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '6224', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '6225', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '6226', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '6227', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '6228', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62290', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62291', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62292', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62293', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62294', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62295', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62296', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62297', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62298', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '62299', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '644', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '645', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '646', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '647', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '648', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '649', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
  { bin: '65', scheme: 'DISCOVER', product: 'CREDIT', country: 'US' },
];

export function detectCardBrand(pan: string): BinRange | undefined {
  const clean = String(pan || '').replace(/\D/g, '');
  if (!clean) return undefined;
  let best: BinRange | undefined;
  for (const r of BIN_RANGES) {
    if (clean.startsWith(r.bin)) {
      if (!best || r.bin.length > best.bin.length) {
        best = r;
      }
    }
  }
  return best;
}

export function detectScheme(pan: string): BrandScheme {
  return detectCardBrand(pan)?.scheme || 'VISA';
}
