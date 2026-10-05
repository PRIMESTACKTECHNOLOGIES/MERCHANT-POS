require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const test = require('node:test');
const { decideBankReceiptAllocation } = require('../src/domain/payouts/bank-incoming-allocation.ts');

const base = {
  matchCount: 1,
  receiptAmount: 100,
  receiptCurrency: 'EUR',
  settlementAmount: 100,
  settlementCurrency: 'EUR',
  existingWalletCredit: false,
  reconciliationDifference: -100,
};

test('allocates only a unique, exact match that reconciles to zero', () => {
  assert.deepEqual(decideBankReceiptAllocation(base), { status: 'ALLOCATED', shouldAllocate: true });
  assert.deepEqual(decideBankReceiptAllocation({
    ...base,
    reconciliationDifference: 0,
    bankCreditAlreadyRecorded: true,
  }), { status: 'ALLOCATED', shouldAllocate: true });
});

test('holds unmatched, ambiguous, amount/currency-mismatched, or already-credited receipts', () => {
  assert.equal(decideBankReceiptAllocation({ ...base, matchCount: 0 }).status, 'HELD_UNMATCHED');
  assert.equal(decideBankReceiptAllocation({ ...base, matchCount: 2 }).status, 'HELD_AMBIGUOUS_REFERENCE');
  assert.equal(decideBankReceiptAllocation({ ...base, settlementAmount: 99 }).status, 'HELD_SETTLEMENT_MISMATCH');
  assert.equal(decideBankReceiptAllocation({ ...base, settlementCurrency: 'USD' }).status, 'HELD_SETTLEMENT_MISMATCH');
  assert.equal(decideBankReceiptAllocation({ ...base, existingWalletCredit: true }).status, 'HELD_ALREADY_CREDITED');
  assert.equal(decideBankReceiptAllocation({ ...base, reconciliationDifference: -99 }).status, 'HELD_RECONCILIATION');
});
