/**
 * Receipt Generator Utility
 * 
 * Helper functions to generate receipt data from various transaction types
 */

interface Transaction {
  id: string;
  type: string;
  amount: number;
  currency?: string;
  status: string;
  created_at: string;
  customer_id?: string;
  customer_name?: string;
  customer_email?: string;
  metadata?: {
    pan_masked?: string;
    auth_code?: string;
    crypto_amount?: string | number;
    crypto_symbol?: string;
    network?: string;
    destination_address?: string;
    tx_hash?: string;
    bank_name?: string;
    account_number?: string;
    reference?: string;
    from_customer?: string;
    to_customer?: string;
    balance_before?: number;
    balance_after?: number;
    fee?: number;
  };
}

interface Customer {
  id: string;
  name: string;
  email: string;
}

interface ReceiptData {
  transactionId: string;
  transactionType: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'CRYPTO_PURCHASE' | 'BANK_PAYOUT';
  amount: number;
  currency: string;
  customerName: string;
  customerEmail: string;
  timestamp: string;
  status: string;
  cardNumber?: string;
  authCode?: string;
  merchantName?: string;
  merchantAddress?: string;
  cryptoAmount?: string;
  cryptoSymbol?: string;
  cryptoAddress?: string;
  cryptoNetwork?: string;
  txHash?: string;
  bankName?: string;
  accountNumber?: string;
  reference?: string;
  fromCustomer?: string;
  toCustomer?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  fee?: number;
}

// Merchant information (can be loaded from config)
const MERCHANT_INFO = {
  name: 'JUKRUTI LOGISTICS PTY LTD',
  address: '9 Houtkapper Str, Olifantshoek\nNorthern Cape, 8450\nSouth Africa',
  phone: '060-7289532 / 078-9550649',
  email: 'Jukrutidumba@gmail.com',
};

/**
 * Generate receipt data from ledger transaction
 */
export function generateReceiptFromTransaction(
  transaction: Transaction,
  customer: Customer,
  additionalData?: Partial<ReceiptData>
): ReceiptData {
  const baseReceipt: ReceiptData = {
    transactionId: transaction.id,
    transactionType: mapTransactionType(transaction.type),
    amount: transaction.amount,
    currency: transaction.currency || 'USD',
    customerName: customer.name,
    customerEmail: customer.email,
    timestamp: transaction.created_at,
    status: transaction.status.toUpperCase(),
    merchantName: MERCHANT_INFO.name,
    merchantAddress: MERCHANT_INFO.address,
  };

  // Add type-specific data
  if (transaction.metadata) {
    const meta = transaction.metadata;

    // Card payment data
    if (meta.pan_masked) {
      baseReceipt.cardNumber = meta.pan_masked;
    }
    if (meta.auth_code) {
      baseReceipt.authCode = meta.auth_code;
    }

    // Crypto data
    if (meta.crypto_amount) {
      baseReceipt.cryptoAmount = `${meta.crypto_amount} ${meta.crypto_symbol || ''}`;
      baseReceipt.cryptoSymbol = meta.crypto_symbol;
      baseReceipt.cryptoNetwork = meta.network;
      baseReceipt.cryptoAddress = meta.destination_address;
      baseReceipt.txHash = meta.tx_hash;
    }

    // Bank payout data
    if (meta.bank_name) {
      baseReceipt.bankName = meta.bank_name;
      baseReceipt.accountNumber = maskAccountNumber(meta.account_number);
      baseReceipt.reference = meta.reference;
    }

    // Transfer data
    if (meta.from_customer) {
      baseReceipt.fromCustomer = meta.from_customer;
    }
    if (meta.to_customer) {
      baseReceipt.toCustomer = meta.to_customer;
    }

    // Balance data
    if (meta.balance_before !== undefined) {
      baseReceipt.balanceBefore = meta.balance_before;
    }
    if (meta.balance_after !== undefined) {
      baseReceipt.balanceAfter = meta.balance_after;
    }

    // Fee data
    if (meta.fee) {
      baseReceipt.fee = meta.fee;
    }
  }

  // Merge with additional data
  return { ...baseReceipt, ...additionalData };
}

/**
 * Map internal transaction type to receipt type
 */
function mapTransactionType(type: string): ReceiptData['transactionType'] {
  const typeMap: Record<string, ReceiptData['transactionType']> = {
    'card_deposit': 'DEPOSIT',
    'deposit': 'DEPOSIT',
    'withdrawal': 'WITHDRAWAL',
    'crypto_withdrawal': 'WITHDRAWAL',
    'transfer': 'TRANSFER',
    'crypto_purchase': 'CRYPTO_PURCHASE',
    'bank_payout': 'BANK_PAYOUT',
    'payout': 'BANK_PAYOUT',
  };

  return typeMap[type.toLowerCase()] || 'DEPOSIT';
}

/**
 * Mask account number for privacy
 */
function maskAccountNumber(accountNumber: string | undefined): string {
  if (!accountNumber) return '****';
  
  const str = accountNumber.toString();
  if (str.length <= 4) return str;
  
  const lastFour = str.slice(-4);
  const masked = '*'.repeat(Math.min(str.length - 4, 8));
  return masked + lastFour;
}

/**
 * Generate receipt for card deposit
 */
export function generateCardDepositReceipt(
  transactionId: string,
  customer: Customer,
  amount: number,
  cardNumber: string,
  authCode: string,
  balanceBefore: number,
  balanceAfter: number
): ReceiptData {
  return {
    transactionId,
    transactionType: 'DEPOSIT',
    amount,
    currency: 'USD',
    customerName: customer.name,
    customerEmail: customer.email,
    timestamp: new Date().toISOString(),
    status: 'APPROVED',
    cardNumber,
    authCode,
    merchantName: MERCHANT_INFO.name,
    merchantAddress: MERCHANT_INFO.address,
    balanceBefore,
    balanceAfter,
  };
}

/**
 * Generate receipt for crypto purchase
 */
export function generateCryptoPurchaseReceipt(
  transactionId: string,
  customer: Customer,
  usdAmount: number,
  cryptoAmount: string,
  cryptoSymbol: string,
  network: string,
  destinationAddress: string,
  txHash: string | undefined,
  balanceBefore: number,
  balanceAfter: number,
  fee: number = 0
): ReceiptData {
  return {
    transactionId,
    transactionType: 'CRYPTO_PURCHASE',
    amount: usdAmount,
    currency: 'USD',
    customerName: customer.name,
    customerEmail: customer.email,
    timestamp: new Date().toISOString(),
    status: 'COMPLETED',
    cryptoAmount: `${cryptoAmount} ${cryptoSymbol}`,
    cryptoSymbol,
    cryptoNetwork: network,
    cryptoAddress: destinationAddress,
    txHash,
    merchantName: MERCHANT_INFO.name,
    merchantAddress: MERCHANT_INFO.address,
    balanceBefore,
    balanceAfter,
    fee,
  };
}

/**
 * Generate receipt for crypto withdrawal
 */
export function generateCryptoWithdrawalReceipt(
  transactionId: string,
  customer: Customer,
  usdAmount: number,
  cryptoAmount: string,
  cryptoSymbol: string,
  network: string,
  destinationAddress: string,
  txHash: string,
  balanceBefore: number,
  balanceAfter: number
): ReceiptData {
  return {
    transactionId,
    transactionType: 'WITHDRAWAL',
    amount: usdAmount,
    currency: 'USD',
    customerName: customer.name,
    customerEmail: customer.email,
    timestamp: new Date().toISOString(),
    status: 'COMPLETED',
    cryptoAmount: `${cryptoAmount} ${cryptoSymbol}`,
    cryptoSymbol,
    cryptoNetwork: network,
    cryptoAddress: destinationAddress,
    txHash,
    merchantName: MERCHANT_INFO.name,
    merchantAddress: MERCHANT_INFO.address,
    balanceBefore,
    balanceAfter,
  };
}

/**
 * Generate receipt for bank payout
 */
export function generateBankPayoutReceipt(
  transactionId: string,
  customer: Customer,
  amount: number,
  bankName: string,
  accountNumber: string,
  reference: string,
  balanceBefore: number,
  balanceAfter: number
): ReceiptData {
  return {
    transactionId,
    transactionType: 'BANK_PAYOUT',
    amount,
    currency: 'USD',
    customerName: customer.name,
    customerEmail: customer.email,
    timestamp: new Date().toISOString(),
    status: 'APPROVED',
    bankName,
    accountNumber: maskAccountNumber(accountNumber),
    reference,
    merchantName: MERCHANT_INFO.name,
    merchantAddress: MERCHANT_INFO.address,
    balanceBefore,
    balanceAfter,
  };
}

/**
 * Generate receipt for customer transfer
 */
export function generateTransferReceipt(
  transactionId: string,
  fromCustomer: Customer,
  toCustomer: Customer,
  amount: number,
  balanceBefore: number,
  balanceAfter: number
): ReceiptData {
  return {
    transactionId,
    transactionType: 'TRANSFER',
    amount,
    currency: 'USD',
    customerName: fromCustomer.name,
    customerEmail: fromCustomer.email,
    timestamp: new Date().toISOString(),
    status: 'COMPLETED',
    fromCustomer: fromCustomer.name,
    toCustomer: toCustomer.name,
    merchantName: MERCHANT_INFO.name,
    merchantAddress: MERCHANT_INFO.address,
    balanceBefore,
    balanceAfter,
  };
}

/**
 * Format amount for display
 */
export function formatAmount(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format date for receipt
 */
export function formatReceiptDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
