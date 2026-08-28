// EMV Integration Example for POSPage.tsx
// This file demonstrates how to integrate the EMV offline transaction engine
// with the existing POS system while maintaining backward compatibility

import { emvEngine, EMVTransactionInput } from '../lib/emv';

/**
 * Example integration of EMV engine into the existing POSPage handleCharge function
 */
export const processEMVTransaction = async (
  amount: number,
  cardData: string,
  pinEntered?: string,
  simulateOffline: boolean = false
) => {
  try {
    // Prepare EMV transaction input
    const emvInput: EMVTransactionInput = {
      cardData,
      amount,
      currency: 'USD',
      terminalData: buildTerminalData(),
      pinEntered,
      transactionType: '00', // Purchase
      terminalCountryCode: '0840', // USA
      merchantCategoryCode: '5411', // Grocery stores
      terminalType: '22' // POS terminal
    };

    // Process transaction through EMV engine
    const result = emvEngine.processTransaction(emvInput);

    if (!result.success) {
      return {
        success: false,
        message: result.reason,
        requiresOnline: false,
        decline: true
      };
    }

    // Handle different transaction outcomes
    if (result.decline) {
      return {
        success: false,
        message: result.reason,
        requiresOnline: false,
        decline: true
      };
    }

    if (result.requiresOnline) {
      if (simulateOffline || !navigator.onLine) {
        // Store for online processing when connection is restored
        const pending = JSON.parse(localStorage.getItem('emv_pending_transactions') || '[]');
        pending.push({
          transactionId: result.transactionId,
          emvData: result.emvData,
          offlineTransaction: result.offlineTransaction,
          timestamp: new Date().toISOString()
        });
        localStorage.setItem('emv_pending_transactions', JSON.stringify(pending));
        
        return {
          success: true,
          message: 'Transaction requires online authorization (stored for later)',
          requiresOnline: true,
          decline: false,
          transactionId: result.transactionId
        };
      } else {
        // Process online immediately
        const onlineResult = await processOnlineAuthorization(result);
        return onlineResult;
      }
    }

    // Offline approval
    if (result.approved) {
      return {
        success: true,
        message: 'Transaction approved offline',
        requiresOnline: false,
        decline: false,
        transactionId: result.transactionId,
        offlineTransaction: result.offlineTransaction
      };
    }

    return {
      success: false,
      message: 'Transaction could not be processed',
      requiresOnline: false,
      decline: true
    };

  } catch (error) {
    console.error('EMV transaction processing error:', error);
    return {
      success: false,
      message: 'Transaction processing failed',
      requiresOnline: false,
      decline: true
    };
  }
};

/**
 * Build terminal data for EMV processing
 */
const buildTerminalData = () => {
  // This would typically come from terminal configuration
  const terminalData = {
    '9F1A': '0840', // Terminal Country Code (USA)
    '5F2A': '0840', // Transaction Currency Code (USD)
    '9A': new Date().toISOString().slice(2, 10).replace(/-/g, ''), // Transaction Date
    '9F21': new Date().toTimeString().slice(0, 8).replace(/:/g, ''), // Transaction Time
    '9C': '00', // Transaction Type (Purchase)
    '9F35': '22', // Terminal Type (POS)
    '9F15': '0000', // Merchant Category Code
    '9F16': 'MERCHANT123', // Merchant Identifier
    '9F1C': '00000001', // Terminal Identification
    '9F4E': 'STORE NAME', // Merchant Name and Location
    '9F1D': '0000000000000000000000', // Terminal Default Action Code
    '9F1E': '0000000000000000000000', // Terminal Online Action Code
    '9F1F': '0000000000000000000000', // Terminal Denial Action Code
  };

  // Convert to TLV format
  let tlvData = '';
  for (const [tag, value] of Object.entries(terminalData)) {
    const length = (value.length / 2).toString(16).padStart(2, '0');
    tlvData += tag + length + value;
  }

  return tlvData;
};

/**
 * Process online authorization for transactions that require it
 */
const processOnlineAuthorization = async (emvResult: any) => {
  try {
    // Prepare online authorization request
    const authRequest = {
      transactionId: emvResult.transactionId,
      amount: emvResult.offlineTransaction.amount,
      currency: emvResult.offlineTransaction.currency,
      emvData: emvResult.emvData,
      cryptogram: emvResult.emvData.cryptogram,
      terminalData: emvResult.offlineTransaction.terminalData,
      timestamp: new Date().toISOString()
    };

    // Simulate online authorization (would call actual payment gateway)
    const onlineResponse = await simulateOnlineAuth(authRequest);

    if (onlineResponse.approved) {
      // Update transaction status
      emvResult.offlineTransaction.offlineApproved = true;
      emvResult.offlineTransaction.uploaded = true;
      
      return {
        success: true,
        message: 'Transaction approved online',
        requiresOnline: false,
        decline: false,
        transactionId: emvResult.transactionId,
        onlineResponse
      };
    } else {
      return {
        success: false,
        message: onlineResponse.message || 'Online authorization declined',
        requiresOnline: false,
        decline: true,
        transactionId: emvResult.transactionId
      };
    }

  } catch (error) {
    console.error('Online authorization error:', error);
    return {
      success: false,
      message: 'Online authorization failed',
      requiresOnline: false,
      decline: true,
      transactionId: emvResult.transactionId
    };
  }
};

/**
 * Simulate online authorization (replace with actual payment gateway call)
 */
const simulateOnlineAuth = async (authRequest: any) => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Simulate 90% approval rate for testing
  const approved = Math.random() > 0.1;
  
  return {
    approved,
    message: approved ? 'Approved' : 'Declined',
    authCode: approved ? '123456' : '000000',
    timestamp: new Date().toISOString()
  };
};

/**
 * Example usage in POSPage component
 */
export const examplePOSIntegration = () => {
  // This would be called from the handleCharge function
  const handleEMVCharge = async (amount: number, cardData: string, pinEntered?: string) => {
    const result = await processEMVTransaction(amount, cardData, pinEntered, simulateOffline);
    
    if (result.success) {
      showToast(result.message, 'success');
      // Update UI, print receipt, etc.
    } else {
      showToast(result.message, 'error');
      // Handle decline, show error, etc.
    }
    
    return result;
  };

  return {
    processEMVTransaction,
    handleEMVCharge
  };
};

/**
 * Batch upload of pending EMV transactions
 */
export const uploadPendingEMVTransactions = async () => {
  const storage = emvEngine.getStorage();
  const pendingTransactions = storage.getTransactionsForUpload();
  
  if (pendingTransactions.length === 0) {
    return { success: true, uploaded: 0, failed: 0 };
  }

  let uploaded = 0;
  let failed = 0;

  for (const transaction of pendingTransactions) {
    try {
      // Upload transaction to payment gateway
      const uploadResult = await uploadTransaction(transaction);
      
      if (uploadResult.success) {
        storage.markTransactionUploaded(transaction.id, true);
        uploaded++;
      } else {
        storage.markTransactionUploaded(transaction.id, false);
        failed++;
      }
    } catch (error) {
      console.error('Failed to upload transaction:', error);
      storage.markTransactionUploaded(transaction.id, false);
      failed++;
    }
  }

  return { success: true, uploaded, failed };
};

/**
 * Upload individual transaction to payment gateway
 */
const uploadTransaction = async (transaction: any) => {
  // This would integrate with your existing payment API
  // For now, simulate a successful upload
  return {
    success: true,
    transactionId: transaction.id,
    message: 'Transaction uploaded successfully'
  };
};

/**
 * Get EMV transaction statistics
 */
export const getEMVTransactionStats = () => {
  const storage = emvEngine.getStorage();
  return storage.getTransactionSummary();
};

/**
 * Export EMV transactions for reporting
 */
export const exportEMVTransactions = (format: 'json' | 'csv' = 'json') => {
  const storage = emvEngine.getStorage();
  return storage.exportTransactions(format);
};