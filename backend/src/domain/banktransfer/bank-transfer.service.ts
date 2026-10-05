import { db } from '../../config/db';
import crypto from 'crypto';
import axios from 'axios';

// ───────────────────────────────────────────────────────────────────────
// BANK TRANSFER SERVICE
// Transak virtual account creation and management for bank transfer payments
// ───────────────────────────────────────────────────────────────────────

export interface VirtualAccountRequest {
  source: {
    fiatCurrency: string;
    paymentMethod: string;
  };
  destination: {
    cryptoCurrency: string;
    walletAddress: string;
    network: string;
  };
  userIp: string;
  accessToken?: string;
  userIdentifier?: string;
}

export interface VirtualAccountResponse {
  status: 'INITIATED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  message: string;
  accountDetails?: {
    accountNumber?: string;
    bankName?: string;
    routingNumber?: string;
    accountHolderName?: string;
    referenceNumber?: string;
  };
  createdAt?: string;
}

export interface BankTransferTransaction {
  id: string;
  merchantId: string;
  quoteId: string;
  virtualAccountId: string;
  amount: number;
  currency: string;
  status: 'INITIATED' | 'PENDING' | 'RECEIVED' | 'COMPLETED' | 'FAILED';
  userEmail?: string;
  userIp: string;
  accountDetails?: any;
  webhook?: any;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get Transak API endpoint and key from environment
 */
function getTransakConfig() {
  const mode = (process.env.TRANSAK_MODE || 'production').toLowerCase();
  const isProduction = mode === 'production';
  const apiKey = process.env.TRANSAK_API_KEY?.trim() || (isProduction ? process.env.TRANSAK_API_KEY_PROD?.trim() : process.env.TRANSAK_API_KEY_STG?.trim()) || 'demo-transak-api-key';
  const demoMode = process.env.TRANSAK_DEMO_MODE === '1' || process.env.TRANSAK_DEMO_MODE === 'true' || !process.env.TRANSAK_API_KEY || /your_|REPLACE|example/i.test(apiKey);

  if (!isProduction && !demoMode) {
    throw new Error('LIVE_TRANSAK_REQUIRED: virtual accounts require TRANSAK_MODE=production.');
  }

  const endpoint = process.env.TRANSAK_BASE_URL?.trim() || (
    isProduction ? 'https://api-gateway.transak.com' : 'https://api-gateway-stg.transak.com'
  );

  return { endpoint, apiKey, mode: demoMode ? 'staging' : mode };
}

async function listProviderVbas(userIp: string): Promise<any[]> {
  const { endpoint, apiKey } = getTransakConfig();
  const { generateAccessToken } = await import('../../exchange/transak.service');
  const accessToken = await generateAccessToken();
  const response = await axios.get(`${endpoint}/api/v2/onramp-stream/vba/list`, {
    params: { status: 'ALL' },
    headers: {
      'x-api-key': apiKey,
      'x-user-ip': userIp,
      'Authorization': `Bearer ${accessToken}`,
    },
    timeout: 15000,
  });
  const items = response.data?.data?.items;
  if (!Array.isArray(items)) throw new Error('Transak VBA list response did not contain data.items');
  return items;
}

async function getProviderVba(virtualBankId: string, userIp: string): Promise<any> {
  const { endpoint, apiKey } = getTransakConfig();
  const { generateAccessToken } = await import('../../exchange/transak.service');
  const accessToken = await generateAccessToken();
  const response = await axios.get(`${endpoint}/api/v2/onramp-stream/vba/${encodeURIComponent(virtualBankId)}`, {
    headers: {
      'x-api-key': apiKey,
      'x-user-ip': userIp,
      'Authorization': `Bearer ${accessToken}`,
    },
    timeout: 15000,
  });
  if (!response.data?.data?.id) throw new Error('Transak VBA detail response did not contain data.id');
  return response.data.data;
}

async function updateProviderVba(
  virtualBankId: string,
  destination: { cryptoCurrency: string; walletAddress: string; network: string },
  userIp: string
): Promise<any> {
  const { endpoint, apiKey } = getTransakConfig();
  const { generateAccessToken } = await import('../../exchange/transak.service');
  const accessToken = await generateAccessToken();
  const response = await axios.put(
    `${endpoint}/api/v2/onramp-stream/vba/${encodeURIComponent(virtualBankId)}`,
    { destination },
    {
      headers: {
        'x-api-key': apiKey,
        'x-user-ip': userIp,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );
  if (!response.data?.data?.id) throw new Error('Transak VBA update response did not contain data.id');
  return response.data.data;
}

/**
 * Create virtual account for bank transfer
 * Calls Transak Create Virtual Account API
 */
export async function createVirtualAccount(
  merchantId: string,
  request: VirtualAccountRequest
): Promise<BankTransferTransaction> {
  try {
    const { endpoint, apiKey } = getTransakConfig();
    const { generateAccessToken } = await import('../../exchange/transak.service');
    const partnerAccessToken = await generateAccessToken();
    const id = crypto.randomUUID();

    console.log(
      `[BankTransfer] Creating merchant VBA: merchant=${merchantId}, asset=${request.destination.cryptoCurrency}, network=${request.destination.network}`
    );

    // Call Transak API
    const authHeaders = request.accessToken
      ? { Authorization: `Bearer ${request.accessToken}` }
      : request.userIdentifier
        ? { 'x-access-token': partnerAccessToken, 'x-user-identifier': request.userIdentifier }
        : { Authorization: `Bearer ${partnerAccessToken}` };

    let transakResponse: any;
    try {
      const response = await axios.post(
        `${endpoint}/api/v2/onramp-stream/vba`,
        {
          source: request.source,
          destination: request.destination,
        },
        {
          headers: {
            'x-api-key': apiKey,
            'x-user-ip': request.userIp,
            ...authHeaders,
            'Content-Type': 'application/json',
          },
        }
      );
      transakResponse = response.data;
    } catch (providerError: any) {
      const status = providerError?.response?.status;
      const msg = providerError?.response?.data?.message || providerError?.response?.data?.error || providerError?.message || 'Provider rejected virtual account creation';
      const demoMode = process.env.TRANSAK_DEMO_MODE === 'true' ||
        process.env.TRANSAK_DEMO_MODE === '1' ||
        !process.env.TRANSAK_API_KEY ||
        /your_|REPLACE|example/i.test(String(process.env.TRANSAK_API_KEY || ''));
      if (demoMode && (status === 401 || status === 403 || status === 400 || !status)) {
        console.warn('[BankTransfer] Using local demo virtual account fallback because demo mode is enabled:', msg);
        const demoAccountNumber = `VA-${merchantId.slice(0, 6).toUpperCase()}-${String(Date.now()).slice(-6)}`;
        transakResponse = {
          data: {
            id: `demo-vba-${Date.now()}`,
            status: 'INITIATED',
            message: 'Local demo virtual account created successfully.',
            success: true,
            accountDetails: {
              accountNumber: demoAccountNumber,
              bankName: 'PrimeStack Demo Virtual Bank',
              routingNumber: '000000000',
              accountHolderName: 'PrimeStack Merchant Vault',
              referenceNumber: `REF-${Date.now()}`,
            },
          },
        };
      } else {
        throw providerError;
      }
    }

    const providerId = String(transakResponse?.data?.id || transakResponse?.id || '');
    if (!providerId || transakResponse?.data?.success === false) {
      throw new Error('Transak returned no merchant virtual-account ID');
    }

    const bankAccountDetails = transakResponse?.data?.accountDetails || {};

    console.log(
      `[BankTransfer] Virtual account creation response: status=${transakResponse?.data?.status || 'INITIATED'}`
    );

    // Store transaction record
    const query = `
      INSERT INTO bank_transfer_transactions
        (id, merchant_id, quote_id, virtual_account_id, amount, currency, status, user_email, user_ip, account_details, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const now = new Date().toISOString();
    const storedAccountDetails = {
      providerId,
      message: transakResponse?.data?.message,
      source: request.source,
      destination: request.destination,
      ...bankAccountDetails,
    };

    await db.query(query, [
      id,
      merchantId,
      providerId,
      providerId,
      0, // Amount will be set when payment received
      request.source.fiatCurrency.toUpperCase(),
      transakResponse?.data?.status || 'INITIATED',
      null,
      request.userIp,
      JSON.stringify(storedAccountDetails),
      now,
      now,
    ]);

    const transaction: BankTransferTransaction = {
      id,
      merchantId,
      quoteId: providerId,
      virtualAccountId: providerId,
      amount: 0,
      currency: request.source.fiatCurrency.toUpperCase(),
      status: transakResponse?.data?.status || 'INITIATED',
      userIp: request.userIp,
      accountDetails: storedAccountDetails,
      createdAt: now,
      updatedAt: now,
    };

    console.log(
      `[BankTransfer] Virtual account created successfully: ${id}`
    );

    return transaction;
  } catch (e: any) {
    console.error('[BankTransfer] Error creating virtual account:', e);

    if (e.response?.status === 401) {
      const providerMessage = e.response?.data?.error?.message || e.response?.data?.message || e.response?.data?.error;
      throw new Error(`Transak authentication rejected: ${providerMessage || 'check production API key and authorization token'}`);
    }
    if (e.response?.status === 400) {
      throw new Error(`Bad request: ${e.response.data?.message || 'Invalid parameters'}`);
    }

    throw e;
  }
}

/**
 * Get bank transfer transaction details
 */
export async function getBankTransferTransaction(
  merchantId: string,
  transactionId: string,
  userIp: string = '0.0.0.0'
): Promise<BankTransferTransaction> {
  try {
    const query = `
      SELECT * FROM bank_transfer_transactions
      WHERE id = ? AND merchant_id = ?
    `;

    const result = await db.query(query, [transactionId, merchantId]);

    if (!result.rows || result.rows.length === 0) {
      throw new Error(`Bank transfer transaction not found: ${transactionId}`);
    }

    const row = result.rows[0] as any;

    const provider = await getProviderVba(String(row.virtual_account_id || row.quote_id), userIp);
    const storedDetails = row.account_details ? JSON.parse(row.account_details) : {};
    const transaction: BankTransferTransaction = {
      id: row.id,
      merchantId: row.merchant_id,
      quoteId: row.quote_id,
      virtualAccountId: row.virtual_account_id,
      amount: Number(row.amount),
      currency: row.currency,
      status: provider.status || row.status,
      userEmail: row.user_email,
      userIp: row.user_ip,
      accountDetails: {
        ...storedDetails,
        providerId: provider.id,
        source: provider.source,
        destination: provider.destination,
        bankAccount: provider.source?.bankAccount,
        bankLocalCode: provider.source?.bankLocalCode,
        status: provider.status,
      },
      webhook: row.webhook_data ? JSON.parse(row.webhook_data) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    return transaction;
  } catch (e: any) {
    console.error('[BankTransfer] Error getting transaction:', e);
    throw e;
  }
}

export async function updateBankTransferTransaction(
  merchantId: string,
  transactionId: string,
  destination: { cryptoCurrency: string; walletAddress: string; network: string },
  userIp: string = '0.0.0.0'
): Promise<BankTransferTransaction> {
  const result = await db.query(
    `SELECT * FROM bank_transfer_transactions WHERE id = ? AND merchant_id = ?`,
    [transactionId, merchantId]
  );
  const row = result.rows?.[0] as any;
  if (!row) throw new Error(`Bank transfer transaction not found: ${transactionId}`);

  const provider = await updateProviderVba(String(row.virtual_account_id || row.quote_id), destination, userIp);
  const storedDetails = row.account_details ? JSON.parse(row.account_details) : {};
  const accountDetails = {
    ...storedDetails,
    providerId: provider.id,
    source: provider.source,
    destination: provider.destination,
    bankAccount: provider.source?.bankAccount,
    bankLocalCode: provider.source?.bankLocalCode,
    status: provider.status,
  };

  await db.query(
    `UPDATE bank_transfer_transactions SET status = ?, account_details = ?, updated_at = ? WHERE id = ? AND merchant_id = ?`,
    [provider.status || row.status, JSON.stringify(accountDetails), new Date().toISOString(), transactionId, merchantId]
  );

  return {
    id: row.id,
    merchantId: row.merchant_id,
    quoteId: row.quote_id,
    virtualAccountId: row.virtual_account_id,
    amount: Number(row.amount),
    currency: row.currency,
    status: provider.status || row.status,
    userEmail: row.user_email,
    userIp: row.user_ip,
    accountDetails,
    webhook: row.webhook_data ? JSON.parse(row.webhook_data) : undefined,
    createdAt: row.created_at,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Update transaction status when payment received
 */
export async function updateTransactionStatus(
  transactionId: string,
  status: 'PENDING' | 'RECEIVED' | 'COMPLETED' | 'FAILED',
  amount?: number,
  webhookData?: any
): Promise<void> {
  try {
    let query = `
      UPDATE bank_transfer_transactions
      SET status = ?, updated_at = ?
    `;

    const params: any[] = [status, new Date().toISOString()];

    if (amount !== undefined) {
      query += `, amount = ?`;
      params.push(amount);
    }

    if (webhookData) {
      query += `, webhook_data = ?`;
      params.push(JSON.stringify(webhookData));
    }

    query += ` WHERE id = ?`;
    params.push(transactionId);

    await db.query(query, params);

    console.log(`[BankTransfer] Transaction status updated: ${transactionId} → ${status}`);
  } catch (e: any) {
    console.error('[BankTransfer] Error updating transaction status:', e);
    throw e;
  }
}

/**
 * List bank transfer transactions for merchant
 */
export async function listBankTransferTransactions(
  merchantId: string,
  limit: number = 50,
  offset: number = 0,
  userIp: string = '0.0.0.0'
): Promise<{ transactions: BankTransferTransaction[]; total: number }> {
  try {
    // Get total count
    const countResult = await db.query(
      `SELECT COUNT(*) as count FROM bank_transfer_transactions WHERE merchant_id = ?`,
      [merchantId]
    );

    const total = Number((countResult.rows?.[0] as any)?.count || 0);

    // Get paginated results
    const query = `
      SELECT * FROM bank_transfer_transactions
      WHERE merchant_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const result = await db.query(query, [merchantId, limit, offset]);

    const providerVbas = await listProviderVbas(userIp);
    const providerById = new Map(providerVbas.map(item => [String(item.id), item]));

    const transactions: BankTransferTransaction[] = (result.rows || []).map((row: any) => {
      const storedDetails = row.account_details ? JSON.parse(row.account_details) : {};
      const provider = providerById.get(String(row.virtual_account_id || row.quote_id));
      const providerDetails = provider ? {
        providerId: provider.id,
        source: provider.source,
        destination: provider.destination,
        bankAccount: provider.source?.bankAccount,
        bankLocalCode: provider.source?.bankLocalCode,
        status: provider.status,
      } : {};

      return {
      id: row.id,
      merchantId: row.merchant_id,
      quoteId: row.quote_id,
      virtualAccountId: row.virtual_account_id,
      amount: Number(row.amount),
      currency: row.currency,
      status: provider?.status || row.status,
      userEmail: row.user_email,
      userIp: row.user_ip,
      accountDetails: { ...storedDetails, ...providerDetails },
      webhook: row.webhook_data ? JSON.parse(row.webhook_data) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      };
    });

    console.log(
      `[BankTransfer] Listed transactions: merchant=${merchantId}, count=${transactions.length}, total=${total}`
    );

    return { transactions, total };
  } catch (e: any) {
    console.error('[BankTransfer] Error listing transactions:', e);
    throw e;
  }
}

/**
 * Get transaction summary for merchant
 */
export async function getBankTransferSummary(merchantId: string): Promise<any> {
  try {
    const query = `
      SELECT
        status,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as total_amount,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM bank_transfer_transactions
      WHERE merchant_id = ?
      GROUP BY status
    `;

    const result = await db.query(query, [merchantId]);

    const summary: any = {
      total: 0,
      byStatus: {},
      totalAmount: 0,
    };

    (result.rows || []).forEach((row: any) => {
      const status = row.status;
      const count = Number(row.count);
      const amount = Number(row.total_amount);

      summary.byStatus[status] = {
        count,
        totalAmount: amount,
      };

      summary.total += count;
      summary.totalAmount += amount;
    });

    console.log(
      `[BankTransfer] Summary for ${merchantId}: ${summary.total} transactions, $${summary.totalAmount}`
    );

    return summary;
  } catch (e: any) {
    console.error('[BankTransfer] Error getting summary:', e);
    throw e;
  }
}

/**
 * Handle Transak webhook for payment received
 */
export async function handleTransakWebhook(webhookData: any): Promise<void> {
  try {
    console.log('[BankTransfer] Received Transak webhook:', webhookData);

    // Verify webhook signature if provided
    const signature = webhookData.signature;
    if (signature) {
      const { apiKey } = getTransakConfig();
      // Webhook verification logic here
      console.log('[BankTransfer] Webhook signature verification skipped (implement as needed)');
    }

    // Find transaction by virtual account ID or quote ID
    const transactionId = webhookData.virtualAccountId || webhookData.quoteId;
    if (!transactionId) {
      console.warn('[BankTransfer] Webhook missing identification: virtualAccountId or quoteId');
      return;
    }

    // Update transaction with payment details
    const amount = webhookData.amount || 0;
    const status = webhookData.status === 'COMPLETED' ? 'COMPLETED' : 'RECEIVED';

    const query = `
      UPDATE bank_transfer_transactions
      SET status = ?, amount = ?, webhook_data = ?, updated_at = ?
      WHERE virtual_account_id = ? OR quote_id = ?
    `;

    await db.query(query, [
      status,
      amount,
      JSON.stringify(webhookData),
      new Date().toISOString(),
      transactionId,
      transactionId,
    ]);

    console.log(`[BankTransfer] Webhook processed: amount=${amount}, status=${status}`);
  } catch (e: any) {
    console.error('[BankTransfer] Error handling webhook:', e);
    throw e;
  }
}
