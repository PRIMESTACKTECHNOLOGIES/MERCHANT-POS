require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { verifyBankIncomingSignature } = require('../src/domain/payouts/bank-incoming-signature.ts');

const secret = 'a-32-byte-minimum-test-secret-value';
const nowMs = 1_800_000_000_000;
const timestamp = String(Math.floor(nowMs / 1000));
const rawBody = Buffer.from('{"transactionId":"bank-123","status":"settled"}');

function sign(body = rawBody, time = timestamp) {
  return crypto.createHmac('sha256', secret).update(time).update('.').update(body).digest('hex');
}

test('accepts a valid HMAC over the exact raw body and fresh timestamp', () => {
  assert.equal(verifyBankIncomingSignature({
    secret, timestamp, signature: sign(), rawBody, nowMs,
  }), true);
});

test('rejects a signature for a modified raw body', () => {
  assert.equal(verifyBankIncomingSignature({
    secret, timestamp, signature: sign(), rawBody: Buffer.from(`${rawBody.toString()} `), nowMs,
  }), false);
});

test('rejects stale timestamps and weak secrets', () => {
  const staleTimestamp = String(Number(timestamp) - 301);
  assert.equal(verifyBankIncomingSignature({
    secret, timestamp: staleTimestamp, signature: sign(rawBody, staleTimestamp), rawBody, nowMs,
  }), false);
  assert.equal(verifyBankIncomingSignature({
    secret: 'short', timestamp, signature: sign(), rawBody, nowMs,
  }), false);
});
