import axios from 'axios';
import { getGlobalServerConfig } from '../../config/globalServer';
import { signPayload } from './signing';

type ReceiverBank = {
  bankName: string;
  iban?: string;
  accountNumber?: string;
  swift?: string;
};

type GlobalResponse = {
  status?: string;
  message?: string;
  availableMinor?: number;
  currency?: string;
  settlementId?: string;
  settledMinor?: number;
  valueDate?: string;
  [key: string]: unknown;
};

function requestConfig(secret: string, apiKey: string, payload: unknown, timeout: number) {
  return {
    headers: {
      'X-API-KEY': apiKey,
      'X-SIGNATURE': signPayload(payload, secret),
      'Content-Type': 'application/json',
    },
    timeout,
  };
}

function responseData(response: { data: unknown }): GlobalResponse {
  if (!response.data || typeof response.data !== 'object') {
    throw new Error('Global server returned an invalid response');
  }
  return response.data as GlobalResponse;
}

function providerError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as GlobalResponse | undefined)?.message;
    return new Error(message || `Global server request failed with status ${error.response?.status || 'unknown'}`);
  }
  return error instanceof Error ? error : new Error('Global server request failed');
}

export async function getAvailableFunds(cardRef: string) {
  const config = getGlobalServerConfig();
  const payload = { cardRef };

  try {
    const response = await axios.post<GlobalResponse>(
      `${config.baseUrl}/balance`,
      payload,
      requestConfig(config.apiSecret, config.apiKey, payload, 10000),
    );
    const data = responseData(response);
    if (data.status !== 'OK' || typeof data.availableMinor !== 'number' || typeof data.currency !== 'string') {
      throw new Error(`Balance check failed: ${data.message || 'Unknown error'}`);
    }
    return { availableMinor: data.availableMinor, currency: data.currency, raw: data };
  } catch (error) {
    throw providerError(error);
  }
}

export async function settleFunds(input: {
  cardRef: string;
  amountMinor: number;
  currency: string;
  authCode: string;
  receiverBank: ReceiverBank;
  reference: string;
}) {
  const config = getGlobalServerConfig();
  const payload = { ...input };

  try {
    const response = await axios.post<GlobalResponse>(
      `${config.baseUrl}/settle`,
      payload,
      requestConfig(config.apiSecret, config.apiKey, payload, 15000),
    );
    const data = responseData(response);
    if (
      data.status !== 'CONFIRMED' ||
      typeof data.settlementId !== 'string' ||
      typeof data.settledMinor !== 'number' ||
      typeof data.currency !== 'string'
    ) {
      throw new Error(`Settlement failed: ${data.message || 'Unknown error'}`);
    }
    return {
      settlementId: data.settlementId,
      settledMinor: data.settledMinor,
      currency: data.currency,
      valueDate: data.valueDate,
      raw: data,
    };
  } catch (error) {
    throw providerError(error);
  }
}
