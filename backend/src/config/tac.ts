export interface TacSettings {
  default: {
    denial: string;
    online: string;
    default: string;
  };
  floorLimit: {
    contact: number;
    contactless: number;
  };
  thresholdBiased: {
    contact: number;
    contactless: number;
  };
  randomSelection: {
    contact: {
      targetPercent: number;
      maxPercent: number;
      floorLimit: number;
    };
    contactless: {
      targetPercent: number;
      maxPercent: number;
      floorLimit: number;
    };
  };
}

const _h = (hex6: string): string => String(hex6 || '000000000000').padStart(12, '0').toUpperCase();

export const TAC_VISA_VSDC: TacSettings = Object.freeze({
  default: {
    denial: _h('0010E0F8A000'),
    online: _h('0010E8F8A000'),
    default: _h('001068000000'),
  },
  floorLimit: {
    contact: 5_000_00,
    contactless: 500_00,
  },
  thresholdBiased: {
    contact: 10_000_00,
    contactless: 1_000_00,
  },
  randomSelection: {
    contact: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
    contactless: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
  },
});

export const TAC_VISA_QVSDC: TacSettings = Object.freeze({
  default: {
    denial: _h('0010E0F8A000'),
    online: _h('0010E8F8A000'),
    default: _h('001068000000'),
  },
  floorLimit: {
    contact: 5_000_00,
    contactless: 200_00,
  },
  thresholdBiased: {
    contact: 10_000_00,
    contactless: 500_00,
  },
  randomSelection: {
    contact: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
    contactless: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
  },
});

export const TAC_MASTERCARD_MCHIP: TacSettings = Object.freeze({
  default: {
    denial: _h('000000000000'),
    online: _h('200000000000'),
    default: _h('000000000000'),
  },
  floorLimit: {
    contact: 5_000_00,
    contactless: 500_00,
  },
  thresholdBiased: {
    contact: 10_000_00,
    contactless: 1_000_00,
  },
  randomSelection: {
    contact: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
    contactless: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
  },
});

export const TAC_MASTERCARD_MOBILE: TacSettings = Object.freeze({
  default: {
    denial: _h('000000000000'),
    online: _h('200000000000'),
    default: _h('000000000000'),
  },
  floorLimit: {
    contact: 5_000_00,
    contactless: 200_00,
  },
  thresholdBiased: {
    contact: 10_000_00,
    contactless: 500_00,
  },
  randomSelection: {
    contact: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
    contactless: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
  },
});

export const TAC_UNIONPAY_QUICPASS: TacSettings = Object.freeze({
  default: {
    denial: _h('000000000000'),
    online: _h('000000000000'),
    default: _h('000000000000'),
  },
  floorLimit: {
    contact: 10_000_00,
    contactless: 300_00,
  },
  thresholdBiased: {
    contact: 20_000_00,
    contactless: 1_000_00,
  },
  randomSelection: {
    contact: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
    contactless: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
  },
});

export const TAC_DEFAULT: TacSettings = Object.freeze({
  default: {
    denial: _h('0010E0F8A000'),
    online: _h('0010E8F8A000'),
    default: _h('001068000000'),
  },
  floorLimit: {
    contact: 5_000_00,
    contactless: 200_00,
  },
  thresholdBiased: {
    contact: 10_000_00,
    contactless: 1_000_00,
  },
  randomSelection: {
    contact: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
    contactless: { targetPercent: 0, maxPercent: 0, floorLimit: 0 },
  },
});

export const TAC_BY_BRAND: Record<string, TacSettings> = Object.freeze({
  VISA: TAC_VISA_VSDC,
  VISA_QVSDC: TAC_VISA_QVSDC,
  VISA_CONTACT: TAC_VISA_VSDC,
  MASTERCARD: TAC_MASTERCARD_MCHIP,
  MASTERCARD_MOBILE: TAC_MASTERCARD_MOBILE,
  MASTERCARD_CONTACT: TAC_MASTERCARD_MCHIP,
  UNIONPAY: TAC_UNIONPAY_QUICPASS,
  QUICPASS: TAC_UNIONPAY_QUICPASS,
  DEFAULT: TAC_DEFAULT,
});

export function getTacForBrand(brand: string): TacSettings {
  const key = String(brand || '').toUpperCase();
  return TAC_BY_BRAND[key] || TAC_BY_BRAND.DEFAULT;
}
