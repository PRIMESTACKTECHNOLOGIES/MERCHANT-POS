require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const TronWeb = require('tronweb');
const { v4: uuidv4 } = require('uuid');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const privateKey = process.env.TRON_PRIVATE_KEY;
const tronWalletAddress = process.env.TRON_WALLET_ADDRESS;
const tronApiKey = process.env.TRON_API_KEY || '';

if (!privateKey || !tronWalletAddress) {
  console.error('TRON keys missing in .env');
  process.exit(1);
}

const tronWeb = new TronWeb({
  fullHost: process.env.TRON_FULL_NODE || 'https://api.trongrid.io',
  headers: tronApiKey ? { 'TRON-PRO-API-KEY': tronApiKey } : undefined,
  privateKey,
});

const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

async function main() {
  console.log('TRON Hot Wallet:', tronWalletAddress);

  // Check TRX balance (gas)
  const trxBalanceSun = await tronWeb.trx.getBalance(tronWalletAddress);
  const trxBalance = trxBalanceSun / 1_000_000;
  console.log('TRX Balance (gas):', trxBalance.toFixed(6), 'TRX');

  // Check USDT balance
  const contract = await tronWeb.contract().at(USDT_CONTRACT);
  const usdtBalanceRaw = await contract.balanceOf(tronWalletAddress).call();
  const usdtDecimals = 6;
  const usdtBalance = Number(usdtBalanceRaw.toString()) / Math.pow(10, usdtDecimals);
  console.log('USDT TRC-20 Balance:', usdtBalance.toFixed(6), 'USDT');

  console.log('\nAmount needed for payout: 107,890.5 USDT');
  const usdtShortfall = Math.max(0, 107890.5 - usdtBalance);
  console.log('USDT shortfall:', usdtShortfall.toFixed(6), 'USDT');

  const trxMin = 20; // minimum enforced
  console.log('Minimum TRX required:', trxMin, 'TRX', '(TRX OK?', trxBalance >= trxMin, ')');
}

main().catch(e => { console.error('ERROR:', e.message || e); process.exit(1); });
