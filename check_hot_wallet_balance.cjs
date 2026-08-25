/**
 * Check Hot Wallet Crypto Balance
 * Run: node check_hot_wallet_balance.cjs
 */

const axios = require('axios');

const TRON_WALLET = 'TFZXzaXXgk3uCcCWbUWKZAydsc95D8GZBP';
const TRON_API_KEY = '';
const TRON_GRID = 'https://api.trongrid.io';
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

function tronAddressToHex(addr) {
  const base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = BigInt(0);
  for (let char of addr) {
    num = num * 58n + BigInt(base58.indexOf(char));
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return '41' + hex.slice(2, -8);
}

function addressToAbiParam(hexAddr) {
  return hexAddr.replace(/^41/, '').padStart(64, '0');
}

async function checkBalances() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         🔥 HOT WALLET BALANCE CHECK                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();
  console.log('📍 Hot Wallet Address:', TRON_WALLET);
  console.log('🌐 TronGrid API:', TRON_GRID);
  console.log('🔑 API Key:', TRON_API_KEY ? '✅ Set' : '⚠️ Not set');
  console.log();
  console.log('─────────────────────────────────────────────────────────');
  console.log();

  try {
    // Check TRX Balance
    console.log('💰 Checking TRX Balance (Gas)...');
    const trxRes = await axios.post(
      `${TRON_GRID}/wallet/getaccount`,
      { address: TRON_WALLET, visible: true },
      { 
        headers: TRON_API_KEY ? { 'TRON-PRO-API-KEY': TRON_API_KEY } : {},
        timeout: 10000 
      }
    );
    
    const trxBalance = (trxRes.data?.balance || 0) / 1_000_000;
    console.log(`   TRX Balance: ${trxBalance.toFixed(6)} TRX`);
    
    if (trxBalance < 20) {
      console.log('   ⚠️  WARNING: Low TRX balance! Need at least 20 TRX for gas.');
      console.log('   📌 Fund your wallet at: https://tronscan.org/#/address/' + TRON_WALLET);
    } else {
      console.log('   ✅ TRX balance sufficient for gas fees');
    }
    console.log();

    // Check USDT Balance
    console.log('₮  Checking USDT Balance (TRC-20)...');
    const usdtRes = await axios.post(
      `${TRON_GRID}/wallet/triggersmartcontract`,
      {
        owner_address: tronAddressToHex(TRON_WALLET),
        contract_address: tronAddressToHex(USDT_CONTRACT),
        function_selector: 'balanceOf(address)',
        parameter: addressToAbiParam(tronAddressToHex(TRON_WALLET)),
        call_value: 0,
      },
      { 
        headers: TRON_API_KEY ? { 'TRON-PRO-API-KEY': TRON_API_KEY } : {},
        timeout: 10000 
      }
    );

    const raw = usdtRes.data?.constant_result?.[0] || '0'.repeat(64);
    const usdtBalance = parseInt(raw, 16) / 1_000_000;
    console.log(`   USDT Balance: ${usdtBalance.toLocaleString()} USDT`);
    
    if (usdtBalance === 0) {
      console.log('   ⚠️  WARNING: NO USDT in hot wallet!');
      console.log('   📌 This is why withdrawals go to MANUAL_PENDING_EXCHANGE_CONFIG');
      console.log('   📌 You need to fund your hot wallet with USDT TRC-20');
      console.log('   📌 Send USDT to: ' + TRON_WALLET);
    } else if (usdtBalance < 100) {
      console.log('   ⚠️  Low USDT balance - may not be enough for withdrawals');
    } else {
      console.log('   ✅ USDT balance available for withdrawals');
    }
    console.log();
    
    console.log('─────────────────────────────────────────────────────────');
    console.log();
    console.log('📊 SUMMARY:');
    console.log(`   TRX (Gas):  ${trxBalance.toFixed(6)} TRX ${trxBalance >= 20 ? '✅' : '❌'}`);
    console.log(`   USDT:       ${usdtBalance.toLocaleString()} USDT ${usdtBalance > 0 ? '✅' : '❌'}`);
    console.log();

    if (usdtBalance === 0) {
      console.log('🔴 ISSUE FOUND: Hot wallet has NO USDT!');
      console.log();
      console.log('📋 TO FIX:');
      console.log('   1. Get some USDT (TRC-20)');
      console.log('   2. Send to your hot wallet: ' + TRON_WALLET);
      console.log('   3. Minimum recommended: 1000 USDT for withdrawals');
      console.log('   4. Check balance again with this script');
      console.log();
      console.log('💡 TIP: You can check balance online at:');
      console.log('   https://tronscan.org/#/address/' + TRON_WALLET);
    } else {
      console.log('✅ Hot wallet is funded and ready for withdrawals!');
    }
    console.log();
    console.log('═══════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Error checking balance:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

checkBalances().catch(console.error);
