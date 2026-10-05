require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const test = require('node:test');
const { calculateVaultLiquidity } = require('../src/domain/vault/liquidity-calculator.ts');

test('does not create a negative risk buffer for an already negative vault balance', () => {
  const result = calculateVaultLiquidity({
    currency: 'EUR',
    vaultBalance: -10099,
    reserve: 0,
    pendingPayouts: 2600,
  });

  assert.equal(result.riskBuffer, 0);
  assert.equal(result.liquidity, -12699);
  assert.equal(result.status, 'CRITICAL');
});

test('applies the risk buffer only to positive funds', () => {
  const result = calculateVaultLiquidity({
    currency: 'eur',
    vaultBalance: 10000,
    reserve: 500,
    pendingPayouts: 1000,
  });

  assert.equal(result.riskBuffer, 1000);
  assert.equal(result.liquidity, 7500);
  assert.equal(result.status, 'HEALTHY');
});

test('rejects invalid liability inputs instead of hiding them', () => {
  assert.throws(
    () => calculateVaultLiquidity({
      currency: 'EUR',
      vaultBalance: 100,
      reserve: -1,
      pendingPayouts: 0,
    }),
    /must not be negative/,
  );
});
