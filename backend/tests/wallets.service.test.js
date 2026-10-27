require('ts-node/register/transpile-only');
const assert = require('assert');
const test = require('node:test');
const { WalletsService } = require('../src/domain/wallets/wallets.service.ts');
const { db } = require('../src/config/db.ts');

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
