require('ts-node/register/transpile-only');
const assert = require('assert');
const test = require('node:test');
const { WalletsService } = require('../src/domain/wallets/wallets.service.ts');
const { db } = require('../src/config/db.ts');
const axios = require('axios');

function createProviderTransferDb() {
  const state = {
    balance: 50,
    status: null,
    providerReference: null,
    merchantCredits: 0,
    customerDebits: 0,
    transferRecord: null,
  };
  db.query = async (sql, params = []) => {
    if (sql.startsWith('CREATE TABLE')) return { rows: [], rowCount: 0 };
    if (sql === 'BEGIN IMMEDIATE' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('SELECT * FROM customer_provider_transfers WHERE reference')) {
      const match = state.transferRecord?.reference === params[0] ? state.transferRecord : null;
      return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
    }
    if (sql.includes('SELECT reference, status FROM customer_provider_transfers')) {
      const active = state.transferRecord && ['PROCESSING', 'UNKNOWN', 'PROVIDER_CONFIRMED'].includes(state.status);
      return { rows: active ? [{ reference: state.transferRecord.reference, status: state.status }] : [], rowCount: active ? 1 : 0 };
    }
    if (sql === 'SELECT id, name FROM customers WHERE id = ?') {
      return { rows: [{ id: params[0], name: 'Customer' }], rowCount: 1 };
    }
    if (sql.includes('SELECT id FROM customer_wallets WHERE customer_id')) return { rows: [{ id: 'customer-wallet' }], rowCount: 1 };
    if (sql.startsWith('UPDATE customer_wallets SET balance = balance -')) {
      if (state.balance < params[3]) return { rows: [], rowCount: 0 };
      state.balance -= params[0];
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO customer_provider_transfers')) {
      state.transferRecord = {
        reference: params[1],
        customer_id: params[2],
        merchant_id: params[3],
        amount_minor: params[5],
        currency: params[6],
      };
      state.status = 'PROCESSING';
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE customer_provider_transfers')) {
      state.status = params[0];
      state.providerReference = params[2];
      if (state.transferRecord) {
        state.transferRecord.status = params[0];
        state.transferRecord.provider_reference = params[2];
      }
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE customer_wallets SET balance = balance +')) {
      state.balance += params[0];
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO wallet_transactions')) {
      state.customerDebits += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO merchant_wallet_transactions')) {
      state.merchantCredits += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT name FROM customers')) return { rows: [{ name: 'Customer' }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  };
  return state;
}

test('topupWalletWithCard rejects when no real authorization evidence is provided', async () => {
  const service = new WalletsService();
  service.getOrCreateWallet = async () => ({ id: 'wallet-1' });

  const originalQuery = db.query;
  db.query = async () => ({ rows: [], rowCount: 0 });

  try {
    await assert.rejects(
      () => service.topupWalletWithCard('customer-1', 25, '4111111111111111', '****1111', '12/30', '123'),
      /Real card authorization is required/
    );
  } finally {
    db.query = originalQuery;
  }
});

test('topupWalletWithCard rejects mocked authorization attempts', async () => {
  const service = new WalletsService();
  service.getOrCreateWallet = async () => ({ id: 'wallet-1' });

  const originalQuery = db.query;
  const originalEnv = process.env.CARD_TOPUP_ALLOW_MOCK;
  process.env.CARD_TOPUP_ALLOW_MOCK = '1';
  db.query = async () => ({ rows: [], rowCount: 0 });

  try {
    await assert.rejects(
      () => service.topupWalletWithCard('customer-1', 25, '4111111111111111', '****1111', '12/30', '123'),
      /Real card authorization is required/
    );
  } finally {
    if (originalEnv === undefined) delete process.env.CARD_TOPUP_ALLOW_MOCK;
    else process.env.CARD_TOPUP_ALLOW_MOCK = originalEnv;
    db.query = originalQuery;
  }
});

test('sendCustomerAssetToHotWallet rolls back if merchant credit persistence fails', async () => {
  const service = new WalletsService();
  service.getOrCreateWallet = async () => ({ id: 'customer-wallet-1' });
  service.getOrCreateMerchantWallet = async () => ({ id: 'merchant-wallet-1' });

  const originalQuery = db.query;
  const queries = [];
  db.query = async (sql) => {
    queries.push(sql);
    if (sql.startsWith('SELECT id, name FROM customers')) return { rows: [{ id: 'customer-1', name: 'Customer' }] };
    if (sql.startsWith('SELECT balance FROM customer_wallets')) return { rows: [{ balance: 50 }] };
    if (sql.startsWith('INSERT INTO merchant_wallet_transactions')) throw new Error('merchant ledger unavailable');
    return { rows: [], rowCount: 1 };
  };

  try {
    await assert.rejects(
      () => service.sendCustomerAssetToHotWallet('customer-1', 'merchant-1', 'fiat', 20, undefined, undefined, 'USD'),
      /merchant ledger unavailable/,
    );
    assert.ok(queries.includes('BEGIN IMMEDIATE'));
    assert.ok(queries.includes('ROLLBACK'));
    assert.equal(queries.includes('COMMIT'), false);
  } finally {
    db.query = originalQuery;
  }
});

test('walletTransfer atomically moves a positive two-decimal balance between customer wallets', async () => {
  const service = new WalletsService();
  service.getOrCreateWallet = async (customerId) => ({ id: `${customerId}-wallet` });

  const originalQuery = db.query;
  const queries = [];
  db.query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql === 'SELECT id FROM customers WHERE id IN (?, ?)') {
      return { rows: [{ id: params[0] }, { id: params[1] }], rowCount: 2 };
    }
    return { rows: [], rowCount: 1 };
  };

  try {
    const result = await service.walletTransfer('sender-1', 'receiver-1', 12.34, 'lunch', 'EUR');
    assert.equal(result.success, true);
    assert.equal(result.amount, 12.34);
    assert.equal(result.currency, 'EUR');
    assert.ok(queries.some(({ sql }) => sql === 'BEGIN IMMEDIATE'));
    assert.ok(queries.some(({ sql }) => sql.includes('balance = balance - ?') && sql.includes('balance >= ?')));
    assert.ok(queries.some(({ sql }) => sql.includes("VALUES (?, ?, 'debit'")));
    assert.ok(queries.some(({ sql }) => sql.includes("VALUES (?, ?, 'credit'")));
    assert.ok(queries.some(({ sql }) => sql === 'COMMIT'));
    assert.equal(queries.some(({ sql }) => sql === 'ROLLBACK'), false);
  } finally {
    db.query = originalQuery;
  }
});

test('walletTransfer rolls back both wallet postings when transfer history cannot be saved', async () => {
  const service = new WalletsService();
  service.getOrCreateWallet = async (customerId) => ({ id: `${customerId}-wallet` });

  const originalQuery = db.query;
  const queries = [];
  db.query = async (sql) => {
    queries.push(sql);
    if (sql === 'SELECT id FROM customers WHERE id IN (?, ?)') {
      return { rows: [{ id: 'sender-1' }, { id: 'receiver-1' }], rowCount: 2 };
    }
    if (sql.includes('INSERT INTO wallet_transfers')) throw new Error('transfer history unavailable');
    return { rows: [], rowCount: 1 };
  };

  try {
    await assert.rejects(
      () => service.walletTransfer('sender-1', 'receiver-1', 12.34, undefined, 'USD'),
      /transfer history unavailable/,
    );
    assert.ok(queries.includes('BEGIN IMMEDIATE'));
    assert.ok(queries.includes('ROLLBACK'));
    assert.equal(queries.includes('COMMIT'), false);
  } finally {
    db.query = originalQuery;
  }
});

test('provider-confirmed fiat transfer debits the customer and credits the merchant', async () => {
  const service = new WalletsService();
  const state = createProviderTransferDb();
  service.getOrCreateMerchantWallet = async () => ({ id: 'merchant-wallet' });
  const originalPost = axios.post;
  const originalAllowedHosts = process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS;
  process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS = 'provider.example';
  let providerRequest;
  let providerCalls = 0;
  axios.post = async (url, body, config) => {
    providerCalls += 1;
    providerRequest = { url, body, config };
    return { data: { status: 'SUCCESS', providerTransactionId: 'PROV-123' } };
  };

  try {
    const params = {
      customerId: 'customer-1',
      merchantId: 'merchant-1',
      amountMinor: 2000,
      currency: 'USD',
      endpointUrl: 'https://provider.example/collect',
      apiKey: 'temporary-key',
      requestReference: 'WPM-12345678ABCDEF123456',
    };
    const result = await service.callProviderAndSendToMerchant(params);
    assert.equal(result.success, true);
    assert.equal(result.providerReference, 'PROV-123');
    assert.equal(state.balance, 30);
    assert.equal(state.status, 'SUCCEEDED');
    assert.equal(state.customerDebits, 1);
    assert.equal(state.merchantCredits, 1);
    assert.equal(providerRequest.body.amountMinor, 2000);
    assert.equal(providerRequest.body.customerId, 'customer-1');
    assert.equal(providerRequest.config.headers.Authorization, 'Bearer temporary-key');
    assert.equal(providerRequest.config.headers['Idempotency-Key'], 'WPM-12345678ABCDEF123456');
    const replay = await service.callProviderAndSendToMerchant(params);
    assert.equal(replay.providerReference, 'PROV-123');
    assert.equal(providerCalls, 1);
    assert.equal(state.balance, 30);
    assert.equal(state.merchantCredits, 1);
  } finally {
    axios.post = originalPost;
    if (originalAllowedHosts === undefined) delete process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS;
    else process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS = originalAllowedHosts;
  }
});

test('provider decline releases the reserved customer balance without merchant credit', async () => {
  const service = new WalletsService();
  const state = createProviderTransferDb();
  const originalPost = axios.post;
  const originalAllowedHosts = process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS;
  process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS = 'provider.example';
  axios.post = async () => ({ data: { status: 'DECLINED', message: 'Payment declined' } });

  try {
    await assert.rejects(
      () => service.callProviderAndSendToMerchant({
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        amountMinor: 2000,
        currency: 'USD',
        endpointUrl: 'https://provider.example/collect',
        apiKey: 'temporary-key',
        requestReference: 'WPM-23456789ABCDEF123456',
      }),
      /Payment declined/,
    );
    assert.equal(state.balance, 50);
    assert.equal(state.status, 'FAILED');
    assert.equal(state.merchantCredits, 0);
  } finally {
    axios.post = originalPost;
    if (originalAllowedHosts === undefined) delete process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS;
    else process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS = originalAllowedHosts;
  }
});

test('uncertain provider result holds funds and blocks a second charge attempt', async () => {
  const service = new WalletsService();
  const state = createProviderTransferDb();
  const originalPost = axios.post;
  const originalAllowedHosts = process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS;
  process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS = 'provider.example';
  let calls = 0;
  axios.post = async () => {
    calls += 1;
    throw new Error('timeout');
  };

  const params = {
    customerId: 'customer-1',
    merchantId: 'merchant-1',
    amountMinor: 2000,
    currency: 'USD',
    endpointUrl: 'https://provider.example/collect',
    apiKey: 'temporary-key',
    requestReference: 'WPM-3456789ABCDEF1234567',
  };
  try {
    await assert.rejects(() => service.callProviderAndSendToMerchant(params), /funds are held/);
    assert.equal(state.balance, 30);
    assert.equal(state.status, 'UNKNOWN');
    await assert.rejects(() => service.callProviderAndSendToMerchant(params), /do not retry/);
    await assert.rejects(
      () => service.callProviderAndSendToMerchant({
        ...params,
        requestReference: 'WPM-456789ABCDEF12345678',
      }),
      /reconcile it before starting another transfer/,
    );
    assert.equal(calls, 1);
    assert.equal(state.merchantCredits, 0);
  } finally {
    axios.post = originalPost;
    if (originalAllowedHosts === undefined) delete process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS;
    else process.env.CUSTOMER_WALLET_PROVIDER_ALLOWED_HOSTS = originalAllowedHosts;
  }
});
