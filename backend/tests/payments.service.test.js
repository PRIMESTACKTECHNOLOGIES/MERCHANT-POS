require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const test = require('node:test');
const { PaymentsService } = require('../src/domain/payments/payments.service.ts');

test('online card charges are not internally approved without a configured real processor', async () => {
  const envKeys = ['ACQUIRER_HOST', 'CARD_PROCESSOR_URL', 'CARD_PROCESSOR_KEY', 'PAYMENT_PROCESSOR_URL'];
  const previousValues = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];

  try {
    const result = await new PaymentsService().authorizeOnlineCharge({
      amountMinor: 1000000000,
      currency: 'USD',
      merchantId: 'MRC-1001',
      terminalId: 'WEB-TERMINAL',
      stan: '000003',
      pan: '4111111111118834',
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'CONFIGURATION_ERROR');
    assert.equal(result.processor.approved, false);
    assert.match(result.error, /not configured/i);
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('an online authorization without explicit capture confirmation remains pending', async () => {
  const axios = require('axios');
  const originalPost = axios.post;
  const envKeys = ['ACQUIRER_HOST', 'CARD_PROCESSOR_URL', 'PAYMENT_PROCESSOR_URL'];
  const previousValues = new Map(envKeys.map((key) => [key, process.env[key]]));
  delete process.env.ACQUIRER_HOST;
  process.env.CARD_PROCESSOR_URL = 'https://processor.invalid/charge';
  process.env.CARD_PROCESSOR_KEY = 'test-key';
  axios.post = async () => ({ data: { success: true, status: 'APPROVED', id: 'auth-123' } });

  try {
    const result = await new PaymentsService().authorizeOnlineCharge({
      amountMinor: 10000,
      currency: 'USD',
      merchantId: 'MRC-1001',
      terminalId: 'WEB-TERMINAL',
      pan: '4111111111118834',
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'PENDING_CAPTURE');
    assert.equal(result.paymentIntentId, 'auth-123');
  } finally {
    axios.post = originalPost;
    for (const [key, value] of previousValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a provider-confirmed captured payment is reported as captured', async () => {
  const axios = require('axios');
  const originalPost = axios.post;
  const envKeys = ['ACQUIRER_HOST', 'CARD_PROCESSOR_URL', 'CARD_PROCESSOR_KEY', 'PAYMENT_PROCESSOR_URL'];
  const previousValues = new Map(envKeys.map((key) => [key, process.env[key]]));
  delete process.env.ACQUIRER_HOST;
  process.env.CARD_PROCESSOR_URL = 'https://processor.invalid/charge';
  process.env.CARD_PROCESSOR_KEY = 'test-key';
  axios.post = async () => ({ data: { success: true, status: 'CAPTURED', id: 'capture-123' } });

  try {
    const result = await new PaymentsService().authorizeOnlineCharge({
      amountMinor: 10000,
      currency: 'USD',
      merchantId: 'MRC-1001',
      terminalId: 'WEB-TERMINAL',
      pan: '4111111111118834',
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'CAPTURED');
    assert.equal(result.paymentIntentId, 'capture-123');
  } finally {
    axios.post = originalPost;
    for (const [key, value] of previousValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('POS server rejects charges above the saved maximum transaction amount', async () => {
  const { db } = require('../src/config/db.ts');
  const originalQuery = db.query;
  const config = [{
    type: 'card',
    enabled: true,
    config: { maxTransactionAmount: 1_000_000_000 },
  }];
  db.query = async (sql) => {
    if (sql.includes('SELECT result_json')) return { rows: [] };
    if (sql.includes('SELECT payment_config')) return { rows: [{ payment_config: JSON.stringify(config) }] };
    if (sql.includes('INSERT OR REPLACE INTO pos_idempotency')) return { rows: [] };
    throw new Error(`Unexpected SQL in amount-limit test: ${sql}`);
  };

  try {
    const result = await new PaymentsService().processPosTransaction({
      amountMinor: 100_000_000_001,
      currency: 'USD',
      merchantId: 'MRC-1001',
      terminalId: 'WEB-TERMINAL',
    });
    assert.equal(result.success, false);
    assert.equal(result.reason, 'MAX_TRANSACTION_AMOUNT_EXCEEDED');
  } finally {
    db.query = originalQuery;
  }
});
