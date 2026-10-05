require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCorsOptions } = require('../src/config/cors.ts');

function checkOrigin(options, origin) {
  return new Promise((resolve, reject) => {
    options.origin(origin, (error, allowed) => {
      if (error) return reject(error);
      resolve(allowed);
    });
  });
}

test('production CORS requires explicit non-wildcard origins', () => {
  assert.throws(() => buildCorsOptions('production', undefined), /explicit origins/);
  assert.throws(() => buildCorsOptions('production', '*'), /explicit origins/);
  assert.throws(() => buildCorsOptions('production', 'https://pos.example, *'), /explicit origins/);
});

test('production CORS allows only configured browser origins', async () => {
  const options = buildCorsOptions('production', ' https://pos.example , https://admin.example ');

  assert.equal(await checkOrigin(options, 'https://pos.example'), true);
  assert.equal(await checkOrigin(options, 'https://admin.example'), true);
  await assert.rejects(checkOrigin(options, 'https://untrusted.example'), /origin not allowed/);
  assert.equal(await checkOrigin(options, undefined), true);
});

test('development CORS keeps the local wildcard fallback', async () => {
  const options = buildCorsOptions('development', undefined);
  assert.equal(await checkOrigin(options, 'http://localhost:5173'), true);
});
