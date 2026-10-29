import React, { useState } from 'react';
import ThermalReceipt from './ThermalReceipt';

/**
 * Example component showing how to use ThermalReceipt
 * This demonstrates different receipt types
 */
export const ReceiptExamples: React.FC = () => {
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);

  // Example 1: Card Payment Receipt
  const showCardPaymentReceipt = () => {
    setReceiptData({
      transactionId: '728454-500M-20260822',
      transactionType: 'DEPOSIT',
      amount: 500000000.00,
      currency: 'USD',
      customerName: 'JJ DUMBA',
      customerEmail: 'jurutidumba@gmail.com',
      timestamp: new Date().toISOString(),
      status: 'APPROVED',
      cardNumber: '****4011',
      authCode: '728454',
      merchantName: 'JUKRUTI LOGISTICS PTY LTD',
      merchantAddress: '9 Houtkapper Str, Olifantshoek\nNorthern Cape, 8450\nSouth Africa',
      balanceBefore: 0,
      balanceAfter: 500000000.00,
    });
    setShowReceipt(true);
  };

  // Example 2: Crypto Purchase Receipt
  const showCryptoPurchaseReceipt = () => {
    setReceiptData({
      transactionId: 'CRYPTO-' + Date.now(),
      transactionType: 'CRYPTO_PURCHASE',
      amount: 1000.00,
      currency: 'USD',
      customerName: 'NGUYEN NGOC SON',
      customerEmail: 'metatradedxb@gmail.com',
      timestamp: new Date().toISOString(),
      status: 'COMPLETED',
      cryptoAmount: '999.50 USDT',
      cryptoSymbol: 'USDT',
      cryptoNetwork: 'TRC-20 (TRON)',
      cryptoAddress: 'TKu9aiVu5qNRgRpnFYNDjmnDuikFPbM7fZ',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      merchantName: 'JUKRUTI LOGISTICS PTY LTD',
      merchantAddress: '9 Houtkapper Str, Olifantshoek\nNorthern Cape, 8450\nSouth Africa',
      balanceBefore: 10000000.00,
      balanceAfter: 9999000.00,
      fee: 0.50,
    });
    setShowReceipt(true);
  };

  // Example 3: Bank Payout Receipt
  const showBankPayoutReceipt = () => {
    setReceiptData({
      transactionId: 'PAYOUT-' + Date.now(),
      transactionType: 'BANK_PAYOUT',
      amount: 50000.00,
      currency: 'USD',
      customerName: 'HUSSAM MOHAMED A ALQA',
      customerEmail: 'hussammohamed191@gmail.com',
      timestamp: new Date().toISOString(),
      status: 'APPROVED',
      bankName: 'ABSA',
      accountNumber: '4110362532',
      reference: 'PAYOUT-HUSSAM-001',
      merchantName: 'JUKRUTI LOGISTICS PTY LTD',
      merchantAddress: '9 Houtkapper Str, Olifantshoek\nNorthern Cape, 8450\nSouth Africa',
      balanceBefore: 50.00,
      balanceAfter: 0.00,
    });
    setShowReceipt(true);
  };

  // Example 4: Transfer Receipt
  const showTransferReceipt = () => {
    setReceiptData({
      transactionId: 'TRANSFER-' + Date.now(),
      transactionType: 'TRANSFER',
      amount: 5000.00,
      currency: 'USD',
      customerName: 'JJ DUMBA',
      customerEmail: 'jurutidumba@gmail.com',
      timestamp: new Date().toISOString(),
      status: 'COMPLETED',
      fromCustomer: 'JJ DUMBA',
      toCustomer: 'NGUYEN NGOC SON',
      merchantName: 'JUKRUTI LOGISTICS PTY LTD',
      merchantAddress: '9 Houtkapper Str, Olifantshoek\nNorthern Cape, 8450\nSouth Africa',
      balanceBefore: 500000000.00,
      balanceAfter: 499995000.00,
    });
    setShowReceipt(true);
  };

  // Example 5: Withdrawal Receipt
  const showWithdrawalReceipt = () => {
    setReceiptData({
      transactionId: 'WITHDRAW-' + Date.now(),
      transactionType: 'WITHDRAWAL',
      amount: 10000.00,
      currency: 'USD',
      customerName: 'NGUYEN NGOC SON',
      customerEmail: 'metatradedxb@gmail.com',
      timestamp: new Date().toISOString(),
      status: 'COMPLETED',
      cryptoAmount: '10,000.00 USDT',
      cryptoSymbol: 'USDT',
      cryptoNetwork: 'TRC-20 (TRON)',
      cryptoAddress: 'TKu9aiVu5qNRgRpnFYNDjmnDuikFPbM7fZ',
      txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      merchantName: 'JUKRUTI LOGISTICS PTY LTD',
      merchantAddress: '9 Houtkapper Str, Olifantshoek\nNorthern Cape, 8450\nSouth Africa',
      balanceBefore: 10000000.00,
      balanceAfter: 9990000.00,
    });
    setShowReceipt(true);
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Thermal Receipt Examples</h2>
      <p>Click any button to see a sample receipt:</p>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '300px' }}>
        <button 
          onClick={showCardPaymentReceipt}
          style={{
            padding: '12px',
            fontSize: '14px',
            cursor: 'pointer',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          💳 Card Payment Receipt ($500M)
        </button>
        
        <button 
          onClick={showCryptoPurchaseReceipt}
          style={{
            padding: '12px',
            fontSize: '14px',
            cursor: 'pointer',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          🪙 Crypto Purchase Receipt
        </button>
        
        <button 
          onClick={showBankPayoutReceipt}
          style={{
            padding: '12px',
            fontSize: '14px',
            cursor: 'pointer',
            background: '#FF9800',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          🏦 Bank Payout Receipt
        </button>
        
        <button 
          onClick={showTransferReceipt}
          style={{
            padding: '12px',
            fontSize: '14px',
            cursor: 'pointer',
            background: '#9C27B0',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          🔄 Transfer Receipt
        </button>
        
        <button 
          onClick={showWithdrawalReceipt}
          style={{
            padding: '12px',
            fontSize: '14px',
            cursor: 'pointer',
            background: '#F44336',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          💸 Withdrawal Receipt
        </button>
      </div>

      {showReceipt && receiptData && (
        <ThermalReceipt 
          data={receiptData} 
          onClose={() => setShowReceipt(false)} 
        />
      )}
    </div>
  );
};

export default ReceiptExamples;
