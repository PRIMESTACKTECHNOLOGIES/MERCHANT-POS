require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const axios = require('axios');

const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const USDT_POLY = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';

const BSC_RPC = process.env.BSC_RPC_NODE || 'https://bsc-dataseed.binance.org';
const POLY_RPC = process.env.POLYGON_RPC_NODE || 'https://polygon-rpc.com';

const WALLET_ADDR = process.env.BSC_WALLET_ADDRESS || process.env.POLYGON_WALLET_ADDRESS || '0x0000000000000000000000000000000000000000';
const TRON_ADDR = process.env.TRON_WALLET_ADDRESS;

function makeCall(url, toAddr, data) {
  return axios.post(url, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: toAddr, data }, 'latest'],
  }, { timeout: 15000 });
}

function balanceCall(addr) {
  const padded = addr.toLowerCase().replace('0x', '').padStart(64, '0');
  return '0x70a08231000000000000000000000000' + padded; // balanceOf(address)
}

function nativeBalanceCall(url, addr) {
  return axios.post(url, {
    jsonrpc: '2.0', id: 1, method: 'eth_getBalance',
    params: [addr, 'latest'],
  }, { timeout: 15000 });
}

function hexToNumber(hex, decimals = 18) {
  if (!hex || hex === '0x' || hex === '0x0') return 0;
  const n = BigInt(hex);
  return Number(n) / Math.pow(10, decimals);
}

async function main() {
  console.log('Checking ALL supported hot wallets for USDT + native gas:');
  console.log('  TRON address      :', TRON_ADDR);
  console.log('  BSC/POLY address  :', WALLET_ADDR);
  console.log('');

  const results = [];

  // BSC
  try {
    const [bnb, usdt] = await Promise.all([
      nativeBalanceCall(BSC_RPC, WALLET_ADDR),
      makeCall(BSC_RPC, USDT_BSC, balanceCall(WALLET_ADDR)),
    ]);
    const bnbBal = hexToNumber(bnb.data.result, 18);
    const usdtBal = hexToNumber(usdt.data.result, 18);
    console.log(`[BSC]   BNB  : ${bnbBal.toFixed(6)} (gas OK? ${bnbBal >= 0.01})`);
    console.log(`[BSC]   USDT : ${usdtBal.toFixed(6)}`);
    results.push({ chain: 'BSC', native: bnbBal, usdt: usdtBal });
  } catch (e) {
    console.log('[BSC]   RPC error:', e.message);
  }
  console.log('');

  // Polygon
  try {
    const [matic, usdt] = await Promise.all([
      nativeBalanceCall(POLY_RPC, WALLET_ADDR),
      makeCall(POLY_RPC, USDT_POLY, balanceCall(WALLET_ADDR)),
    ]);
    const mBal = hexToNumber(matic.data.result, 18);
    const uBal = hexToNumber(usdt.data.result, 6); // Polygon USDT decimals 6
    console.log(`[POLY]  MATIC: ${mBal.toFixed(6)} (gas OK? ${mBal >= 1.0})`);
    console.log(`[POLY]  USDT : ${uBal.toFixed(6)}`);
    results.push({ chain: 'POLYGON', native: mBal, usdt: uBal });
  } catch (e) {
    console.log('[POLY]  RPC error:', e.message);
  }
  console.log('');

  // Cross-chain summary
  console.log('═══════════════════════════════════════════════════════════');
  const totalUsdt = results.reduce((s, r) => s + r.usdt, 0);
  console.log('TOTAL cross-chain USDT (hot wallets):', totalUsdt.toFixed(6));
  console.log('Required for payout f1765ae6…        : 107,890.50 USDT');
  console.log('Deficit (sum across BSC+POLY only)    :', Math.max(0, 107890.5 - totalUsdt).toFixed(6), 'USDT');
  console.log('(TRON was already checked: 4.499998 USDT / 1 TRX)');
}

main().catch(e => { console.error(e.message); process.exit(1); });
