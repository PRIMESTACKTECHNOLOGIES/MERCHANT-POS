import axios from 'axios';

export interface BankPayoutRequest {
  merchantId: string;
  payoutId: string;
  amount: number;
  currency?: string;
  bankAccount: any;
  reference?: string;
}

export interface BankPayoutResult {
  success: boolean;
  provider: string;
  providerReference?: string;
  status: string;
  raw?: any;
}

export async function submitBankPayout(request: BankPayoutRequest): Promise<BankPayoutResult> {
  const provider = (process.env.BANK_PAYOUT_PROVIDER || 'external').trim().toLowerCase();
  const apiUrl = process.env.BANK_PAYOUT_API_URL?.trim();
  const apiKey = process.env.BANK_PAYOUT_API_KEY?.trim() || process.env.WISE_API_KEY?.trim();

  if (!apiUrl) {
    throw new Error('BANK_PAYOUT_API_URL is required for live payouts.');
  }

  if (!apiKey) {
    throw new Error('BANK_PAYOUT_API_KEY or WISE_API_KEY is required for live payouts.');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers.Authorization = `Bearer ${apiKey}`;

  const payload = {
    provider,
    merchant_id: request.merchantId,
    payout_id: request.payoutId,
    amount: Number(request.amount),
    currency: request.currency || 'USD',
    reference: request.reference || request.payoutId,
    recipient: {
      bank_name: request.bankAccount?.bank_name || request.bankAccount?.bankName || null,
      account_holder: request.bankAccount?.account_holder || request.bankAccount?.accountHolder || null,
      account_number: request.bankAccount?.account_number || request.bankAccount?.accountNumber || null,
      routing_number: request.bankAccount?.routing_number || request.bankAccount?.routingNumber || null,
      iban: request.bankAccount?.iban || null,
      swift_code: request.bankAccount?.swiftCode || null,
    }
  };

  const response = await axios.post(apiUrl, payload, {
    headers,
    timeout: 20000,
  });

  const providerReference = response.data?.id || response.data?.transfer_id || response.data?.payment_id || response.data?.reference || response.data?.data?.id;
  const status = String(response.data?.status || response.data?.state || response.data?.transfer_state || 'submitted');

  return {
    success: true,
    provider,
    providerReference,
    status,
    raw: response.data,
  };
}

export default { submitBankPayout };
