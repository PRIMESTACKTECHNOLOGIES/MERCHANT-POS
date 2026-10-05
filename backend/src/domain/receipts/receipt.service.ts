import { v4 as uuidv4 } from 'uuid';

/**
 * Receipt Service
 * 
 * Generates and stores receipts for all transactions
 * Maintains receipt history for audit and reprinting
 * 
 * NOTE: This service needs migration to DbAdapter async API.
 * Currently stubbed out to allow compilation.
 */
export class ReceiptService {
  constructor() {
    // Stub - needs migration to DbAdapter
  }

  async generateCardPaymentReceipt(
    customerId: string,
    transactionId: string,
    amount: number,
    cardNumber: string,
    authCode: string,
    balanceBefore: number,
    balanceAfter: number
  ): Promise<string> {
    const receiptId = uuidv4();
    console.log(`[Receipt] Stub: generateCardPaymentReceipt - ${receiptId}`);
    return receiptId;
  }

  async generateCryptoPurchaseReceipt(
    customerId: string,
    transactionId: string,
    usdAmount: number,
    cryptoAmount: string,
    cryptoSymbol: string,
    network: string,
    destinationAddress: string,
    txHash: string | undefined,
    balanceBefore: number,
    balanceAfter: number,
    fee: number = 0
  ): Promise<string> {
    const receiptId = uuidv4();
    console.log(`[Receipt] Stub: generateCryptoPurchaseReceipt - ${receiptId}`);
    return receiptId;
  }

  async getReceipt(receiptId: string): Promise<any | null> {
    console.log(`[Receipt] Stub: getReceipt - ${receiptId}`);
    return null;
  }

  async getReceiptsByCustomer(customerId: string, limit: number = 50): Promise<any[]> {
    console.log(`[Receipt] Stub: getReceiptsByCustomer - ${customerId}`);
    return [];
  }
}

export const receiptService = new ReceiptService();
