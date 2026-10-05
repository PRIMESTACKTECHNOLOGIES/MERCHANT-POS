import axios, { AxiosRequestConfig } from 'axios';

type DwollaTransferStatus = 'QUEUED' | 'PENDING' | 'PROCESSED' | 'FAILED';

export interface DwollaPayoutInstruction {
  payoutId: string;
  amount: number;
  currency: string;
  reference: string;
  destinationFundingSourceUrl?: string;
  metadata?: Record<string, string>;
}

export interface DwollaPayoutResult {
  success: boolean;
  status: DwollaTransferStatus | 'CONFIG_ERROR' | 'ERROR';
  providerReference?: string;
  raw?: unknown;
  message?: string;
}

export interface DwollaCustomerInput {
  firstName: string;
  lastName: string;
  email: string;
  businessName?: string;
  ipAddress?: string;
}

const DWOLLA_ENV = (process.env.DWOLLA_ENV || process.env.DWOLLA_ENVIRONMENT || 'sandbox').toLowerCase();
const DWOLLA_API_URL = (
  process.env.DWOLLA_API_URL
  || (DWOLLA_ENV === 'production'
    ? 'https://api.dwolla.com'
    : 'https://api-sandbox.dwolla.com')
).replace(/\/+$/, '');

function required(name: string): string {
  return (process.env[name] || '').trim();
}

async function getAccessToken(): Promise<string> {
  const key = required('DWOLLA_APP_KEY') || required('DWOLLA_API_KEY');
  const secret = required('DWOLLA_APP_SECRET') || required('DWOLLA_API_SECRET');
  if (!key || !secret) throw new Error('DWOLLA_APP_KEY and DWOLLA_APP_SECRET are required');

  const response = await axios.post(
    `${DWOLLA_API_URL}/token`,
    new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
    {
      auth: { username: key, password: secret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      timeout: 15000,
    },
  );
  if (!response.data?.access_token) throw new Error('Dwolla token response did not include access_token');
  return String(response.data.access_token);
}

function headers(token: string, idempotencyKey: string): AxiosRequestConfig['headers'] {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.dwolla.v1.hal+json',
    'Content-Type': 'application/vnd.dwolla.v1.hal+json',
    'Idempotency-Key': idempotencyKey,
  };
}

function halHeaders(token: string): AxiosRequestConfig['headers'] {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.dwolla.v1.hal+json',
    'Content-Type': 'application/vnd.dwolla.v1.hal+json',
  };
}

export async function createDwollaCustomer(input: DwollaCustomerInput): Promise<string> {
  const token = await getAccessToken();
  const response = await axios.post(`${DWOLLA_API_URL}/customers`, input, {
    headers: halHeaders(token),
    timeout: 20000,
  });
  const location = response.headers.location;
  if (!location) throw new Error('Dwolla customer response did not include a resource URL');
  return String(location);
}

export async function createDwollaFundingSource(
  customerUrl: string,
  input: {
    routingNumber: string;
    accountNumber: string;
    bankAccountType: 'checking' | 'savings';
    name: string;
  },
): Promise<string> {
  const token = await getAccessToken();
  const response = await axios.post(`${customerUrl.replace(/\/+$/, '')}/funding-sources`, input, {
    headers: halHeaders(token),
    timeout: 20000,
  });
  const location = response.headers.location;
  if (!location) throw new Error('Dwolla funding-source response did not include a resource URL');
  return String(location);
}

export async function listDwollaFundingSources(resourceUrl: string): Promise<unknown> {
  const token = await getAccessToken();
  const response = await axios.get(`${resourceUrl.replace(/\/+$/, '')}/funding-sources`, {
    headers: halHeaders(token),
    timeout: 20000,
  });
  return response.data;
}

export async function submitDwollaPayout(
  instruction: DwollaPayoutInstruction,
): Promise<DwollaPayoutResult> {
  const source = required('DWOLLA_SOURCE_FUNDING_SOURCE_URL')
    || (() => {
      const id = required('DWOLLA_FUNDING_SOURCE_ID');
      return id ? `${DWOLLA_API_URL}/funding-sources/${id}` : '';
    })();
  const destination = instruction.destinationFundingSourceUrl?.trim();
  if (!source || !destination) {
    return {
      success: false,
      status: 'CONFIG_ERROR',
      message: 'DWOLLA_SOURCE_FUNDING_SOURCE_URL and destination funding source URL are required',
    };
  }
  if (!Number.isFinite(instruction.amount) || instruction.amount <= 0) {
    return { success: false, status: 'CONFIG_ERROR', message: 'Dwolla payout amount must be positive' };
  }
  if (instruction.currency.toUpperCase() !== 'USD') {
    return { success: false, status: 'CONFIG_ERROR', message: 'Dwolla ACH payouts currently require USD' };
  }

  try {
    const token = await getAccessToken();
    const response = await axios.post(
      `${DWOLLA_API_URL}/transfers`,
      {
        _links: {
          source: { href: source },
          destination: { href: destination },
        },
        amount: {
          currency: 'USD',
          value: instruction.amount.toFixed(2),
        },
        metadata: {
          payoutId: instruction.payoutId,
          reference: instruction.reference,
          ...(instruction.metadata || {}),
        },
      },
      {
        headers: headers(token, instruction.payoutId),
        timeout: 20000,
        validateStatus: status => status === 201 || status === 202,
      },
    );

    const location = response.headers.location || response.headers['location'];
    return {
      success: true,
      status: 'QUEUED',
      providerReference: location ? String(location).split('/').pop() : undefined,
      raw: { location },
    };
  } catch (error: any) {
    return {
      success: false,
      status: 'ERROR',
      message: error?.response?.data?.message || error?.message || 'Dwolla transfer failed',
      raw: error?.response?.data,
    };
  }
}
