require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const test = require('node:test');
const axios = require('axios');
const { BatchesService } = require('../src/domain/batches/batches.service.ts');
const { walletsService } = require('../src/domain/wallets/wallets.service.ts');

test('processor lookup does not treat an arbitrary 2xx response as authorization confirmation', async () => {
  const originalPost = axios.post;
  const keys = ['CARD_PROCESSOR_ENABLED', 'CARD_PROCESSOR_LOOKUP_URL', 'CARD_PROCESSOR_CAPTURE_URL'];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.CARD_PROCESSOR_ENABLED = 'true';
  process.env.CARD_PROCESSOR_LOOKUP_URL = 'https://processor.invalid/lookup';
  process.env.CARD_PROCESSOR_CAPTURE_URL = 'https://processor.invalid/capture';
  let requestCount = 0;
  axios.post = async () => {
    requestCount += 1;
    return { data: { message: 'HTTP succeeded without a processor decision' } };
  };

  try {
    const result = await new BatchesService().processorLookupAndCapture('MRC-1001', {
      id: 'txn-1',
      local_txn_id: 'local-1',
      batch_id: 'batch-1',
      terminal_id: 'terminal-1',
      stan: '000001',
      amount_minor: 5000,
      currency: 'USD',
      pan_masked: '****1234',
    });

    test('confirmed offline capture credits the selected customer wallet', async () => {
      const originalCredit = walletsService.creditCustomerWallet;
      let creditArgs;
      walletsService.creditCustomerWallet = async (...args) => {
        creditArgs = args;
        return { success: true, transactionId: 'wallet-credit-1' };
      };

      try {
        const result = await new BatchesService().creditCapturedOfflineSale(
          'customer-42',
          'pos-transaction-1',
          'CAPTURE-REF-1',
          25,
          'USD',
        );
        assert.equal(result.success, true);
        assert.deepEqual(creditArgs, [
          'customer-42',
          25,
          'offline_batch_capture',
          'CAPTURE-REF-1',
          'USD',
        ]);
      } finally {
        walletsService.creditCustomerWallet = originalCredit;
      }
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'HTTP succeeded without a processor decision');
    assert.equal(requestCount, 1);
  } finally {
    axios.post = originalPost;
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
