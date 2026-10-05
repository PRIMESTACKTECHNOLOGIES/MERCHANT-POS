import axios from 'axios';

export interface AchInstruction {
  settlementId: string;
  merchantId: string;
  amount: number;
  currency: string;
  beneficiaryName: string;
  beneficiaryRouting: string;
  beneficiaryAccount: string;
  reference: string;
}

export interface WireInstruction {
  settlementId: string;
  merchantId: string;
  amount: number;
  currency: string;
  swiftCode: string;
  iban: string;
  beneficiaryName: string;
  reference: string;
}

export interface SepaInstruction {
  settlementId: string;
  merchantId: string;
  amount: number;
  currency: string;
  iban: string;
  bic: string;
  beneficiaryName: string;
  reference: string;
}

const apiUrl = (process.env.BANK_PARTNER_API_URL || 'http://127.0.0.1:9100').trim().replace(/\/+$/, '');
const apiKey = (process.env.BANK_PARTNER_API_KEY || '').trim();
const apiSecret = (process.env.BANK_PARTNER_SECRET || '').trim();

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-BankPartner-Key': apiKey,
    'X-BankPartner-Secret': apiSecret,
  };
}

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await axios.post(`${apiUrl}${path}`, body, {
    headers: headers(),
    timeout: 15_000,
  });
  return (response.data && typeof response.data === 'object' ? response.data : {}) as Record<string, unknown>;
}

export const bankPartnerClient = {
  sendACH(instruction: AchInstruction) {
    return post('/ach/transfer', {
      payoutId: instruction.settlementId,
      merchantId: instruction.merchantId,
      amount: instruction.amount,
      currency: instruction.currency,
      beneficiary: {
        name: instruction.beneficiaryName,
        routingNumber: instruction.beneficiaryRouting,
        accountNumber: instruction.beneficiaryAccount,
      },
      reference: instruction.reference,
    });
  },

  sendWire(instruction: WireInstruction) {
    return post('/wire/mt103', {
      payoutId: instruction.settlementId,
      merchantId: instruction.merchantId,
      amount: instruction.amount,
      currency: instruction.currency,
      beneficiary: {
        name: instruction.beneficiaryName,
        swiftCode: instruction.swiftCode,
        iban: instruction.iban,
      },
      reference: instruction.reference,
    });
  },

  sendSEPA(instruction: SepaInstruction) {
    return post('/sepa/pain001', {
      payoutId: instruction.settlementId,
      merchantId: instruction.merchantId,
      amount: instruction.amount,
      currency: instruction.currency,
      iban: instruction.iban,
      bic: instruction.bic,
      beneficiaryName: instruction.beneficiaryName,
      reference: instruction.reference,
    });
  },
};
