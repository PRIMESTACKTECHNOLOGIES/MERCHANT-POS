import { TLVParser } from './tlv-parser';
import type { EMVTag } from './tlv-parser';

export interface EMVTransaction {
  id: string;
  timestamp: Date;
  amount: number;
  currency: string;
  cardData: string;
  terminalData: string;
  application: {
    aid: string;
    label: string;
    priority: number;
  };
  authentication: {
    method: 'SDA' | 'DDA' | 'CDA';
    success: boolean;
    certificate?: string;
  };
  risk: {
    terminal: {
      proceed: boolean;
      reason?: string;
      requiresOnline: boolean;
    };
    card: {
      proceed: boolean;
      reason?: string;
      requiresOnline: boolean;
      decline: boolean;
    };
  };
  cvm: {
    method: string;
    result: boolean;
    pinVerified?: boolean;
  };
  actionCodes: {
    decision: 'APPROVE' | 'DECLINE' | 'ONLINE';
    reason: string;
    terminalActionCode?: string;
    issuerActionCode?: string;
  };
  cryptogram: {
    decision: 'TC' | 'AAC' | 'ARQC';
    cryptogram: string;
    reason: string;
    cryptogramInformationData?: string;
    applicationTransactionCounter?: string;
  };
  terminalVerificationResults: string;
  transactionStatusInformation: string;
  offlineApproved: boolean;
  uploaded: boolean;
  uploadAttempts: number;
  lastUploadAttempt?: Date;
}

export interface OfflineStorageConfig {
  maxTransactions: number;
  maxAgeDays: number;
  uploadBatchSize: number;
  retryAttempts: number;
}

export class OfflineTransactionStorage {
  private config: OfflineStorageConfig;
  private storageKey: string;
  private pendingKey: string;

  constructor(config: OfflineStorageConfig = {
    maxTransactions: 1000,
    maxAgeDays: 30,
    uploadBatchSize: 50,
    retryAttempts: 3
  }) {
    this.config = config;
    this.storageKey = 'emv-offline-transactions';
    this.pendingKey = 'emv-pending-transactions';
  }

  storeTransaction(transaction: EMVTransaction): boolean {
    try {
      const transactions = this.getAllTransactions();
      
      // Check if we need to remove old transactions
      if (transactions.length >= this.config.maxTransactions) {
        this.cleanupOldTransactions();
      }

      // Add the new transaction
      transactions.push(transaction);
      
      // Sort by timestamp (newest first)
      transactions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      // Save to localStorage
      localStorage.setItem(this.storageKey, JSON.stringify(transactions));
      
      return true;
    } catch (error) {
      console.error('Failed to store EMV transaction:', error);
      return false;
    }
  }

  getAllTransactions(): EMVTransaction[] {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return [];
      
      const transactions = JSON.parse(stored) as EMVTransaction[];
      
      // Convert date strings back to Date objects
      return transactions.map(tx => ({
        ...tx,
        timestamp: new Date(tx.timestamp)
      }));
    } catch (error) {
      console.error('Failed to retrieve EMV transactions:', error);
      return [];
    }
  }

  getPendingTransactions(): EMVTransaction[] {
    try {
      const stored = localStorage.getItem(this.pendingKey);
      if (!stored) return [];
      
      const transactions = JSON.parse(stored) as EMVTransaction[];
      
      // Convert date strings back to Date objects
      return transactions.map(tx => ({
        ...tx,
        timestamp: new Date(tx.timestamp)
      }));
    } catch (error) {
      console.error('Failed to retrieve pending transactions:', error);
      return [];
    }
  }

  getTransactionsForUpload(): EMVTransaction[] {
    const allTransactions = this.getAllTransactions();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.maxAgeDays);
    
    return allTransactions
      .filter(tx => !tx.uploaded && tx.timestamp > cutoffDate)
      .slice(0, this.config.uploadBatchSize);
  }

  markTransactionUploaded(transactionId: string, success: boolean): boolean {
    try {
      const transactions = this.getAllTransactions();
      const transaction = transactions.find(tx => tx.id === transactionId);
      
      if (!transaction) {
        console.warn(`Transaction ${transactionId} not found`);
        return false;
      }

      if (success) {
        transaction.uploaded = true;
        transaction.uploadAttempts = 0;
      } else {
        transaction.uploadAttempts++;
        transaction.lastUploadAttempt = new Date();
      }

      localStorage.setItem(this.storageKey, JSON.stringify(transactions));
      return true;
    } catch (error) {
      console.error('Failed to update transaction upload status:', error);
      return false;
    }
  }

  markTransactionPending(transactionId: string): boolean {
    try {
      const transactions = this.getAllTransactions();
      const transaction = transactions.find(tx => tx.id === transactionId);
      
      if (!transaction) {
        console.warn(`Transaction ${transactionId} not found`);
        return false;
      }

      const pendingTransactions = this.getPendingTransactions();
      pendingTransactions.push(transaction);
      
      localStorage.setItem(this.pendingKey, JSON.stringify(pendingTransactions));
      return true;
    } catch (error) {
      console.error('Failed to mark transaction as pending:', error);
      return false;
    }
  }

  removePendingTransaction(transactionId: string): boolean {
    try {
      const pendingTransactions = this.getPendingTransactions();
      const filtered = pendingTransactions.filter(tx => tx.id !== transactionId);
      
      localStorage.setItem(this.pendingKey, JSON.stringify(filtered));
      return true;
    } catch (error) {
      console.error('Failed to remove pending transaction:', error);
      return false;
    }
  }

  getTransactionSummary(): {
    total: number;
    pending: number;
    uploaded: number;
    failed: number;
    totalAmount: number;
    oldestTransaction?: Date;
    newestTransaction?: Date;
  } {
    const transactions = this.getAllTransactions();
    const pending = this.getPendingTransactions();
    
    const summary = {
      total: transactions.length,
      pending: pending.length,
      uploaded: transactions.filter(tx => tx.uploaded).length,
      failed: transactions.filter(tx => tx.uploadAttempts >= this.config.retryAttempts).length,
      totalAmount: transactions.reduce((sum, tx) => sum + tx.amount, 0),
      oldestTransaction: transactions.length > 0 ? new Date(Math.min(...transactions.map(tx => tx.timestamp.getTime()))) : undefined,
      newestTransaction: transactions.length > 0 ? new Date(Math.max(...transactions.map(tx => tx.timestamp.getTime()))) : undefined
    };

    return summary;
  }

  getStorageStats(): {
    used: number;
    available: number;
    percentage: number;
  } {
    try {
      const allTransactions = this.getAllTransactions();
      const transactionsJSON = JSON.stringify(allTransactions);
      const sizeInBytes = new Blob([transactionsJSON]).size;
      
      // Estimate localStorage capacity (varies by browser, typically 5-10MB)
      const estimatedCapacity = 5 * 1024 * 1024; // 5MB
      const percentage = (sizeInBytes / estimatedCapacity) * 100;

      return {
        used: sizeInBytes,
        available: estimatedCapacity - sizeInBytes,
        percentage: Math.round(percentage * 100) / 100
      };
    } catch (error) {
      return {
        used: 0,
        available: 5 * 1024 * 1024,
        percentage: 0
      };
    }
  }

  cleanupOldTransactions(): number {
    try {
      const transactions = this.getAllTransactions();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.maxAgeDays);
      
      const filtered = transactions.filter(tx => tx.timestamp > cutoffDate);
      const removed = transactions.length - filtered.length;
      
      localStorage.setItem(this.storageKey, JSON.stringify(filtered));
      return removed;
    } catch (error) {
      console.error('Failed to cleanup old transactions:', error);
      return 0;
    }
  }

  clearAllTransactions(): boolean {
    try {
      localStorage.removeItem(this.storageKey);
      localStorage.removeItem(this.pendingKey);
      return true;
    } catch (error) {
      console.error('Failed to clear all transactions:', error);
      return false;
    }
  }

  exportTransactions(format: 'json' | 'csv' = 'json'): string {
    const transactions = this.getAllTransactions();
    
    if (format === 'csv') {
      return this.exportToCSV(transactions);
    }
    
    return JSON.stringify(transactions, null, 2);
  }

  private exportToCSV(transactions: EMVTransaction[]): string {
    const headers = [
      'ID', 'Timestamp', 'Amount', 'Currency', 'Application AID', 'Application Label',
      'Authentication Method', 'Authentication Success', 'Risk Terminal Proceed',
      'Risk Card Proceed', 'CVM Method', 'CVM Result', 'Action Decision',
      'Cryptogram Decision', 'Offline Approved', 'Uploaded'
    ];

    const rows = transactions.map(tx => [
      tx.id,
      tx.timestamp.toISOString(),
      tx.amount.toString(),
      tx.currency,
      tx.application.aid,
      tx.application.label,
      tx.authentication.method,
      tx.authentication.success.toString(),
      tx.risk.terminal.proceed.toString(),
      tx.risk.card.proceed.toString(),
      tx.cvm.method,
      tx.cvm.result.toString(),
      tx.actionCodes.decision,
      tx.cryptogram.decision,
      tx.offlineApproved.toString(),
      tx.uploaded.toString()
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  // Compatibility method for existing POS system
  getLegacyTransactionFormat(): Array<{
    amount: number;
    timestamp: Date;
    emvData?: any;
  }> {
    const transactions = this.getAllTransactions();
    return transactions.map(tx => ({
      amount: tx.amount,
      timestamp: tx.timestamp,
      emvData: {
        id: tx.id,
        application: tx.application,
        authentication: tx.authentication,
        risk: tx.risk,
        cvm: tx.cvm,
        actionCodes: tx.actionCodes,
        cryptogram: tx.cryptogram,
        offlineApproved: tx.offlineApproved
      }
    }));
  }

  // Method to migrate from legacy format
  migrateFromLegacy(legacyTransactions: Array<{ amount: number; timestamp: Date }>): number {
    let migrated = 0;
    
    for (const legacy of legacyTransactions) {
      try {
        const transaction: EMVTransaction = {
          id: this.generateTransactionId(),
          timestamp: legacy.timestamp,
          amount: legacy.amount,
          currency: 'USD',
          cardData: '',
          terminalData: '',
          application: {
            aid: 'A0000000041010', // Default Visa
            label: 'VISA DEBIT',
            priority: 1
          },
          authentication: {
            method: 'SDA',
            success: true
          },
          risk: {
            terminal: {
              proceed: true,
              requiresOnline: false
            },
            card: {
              proceed: true,
              requiresOnline: false,
              decline: false
            }
          },
          cvm: {
            method: 'NO_CVM',
            result: true
          },
          actionCodes: {
            decision: 'APPROVE',
            reason: 'Legacy transaction migrated'
          },
          cryptogram: {
            decision: 'TC',
            cryptogram: '0000000000000000',
            reason: 'Legacy transaction migrated'
          },
          terminalVerificationResults: '0000000000',
          transactionStatusInformation: '0000',
          offlineApproved: true,
          uploaded: false,
          uploadAttempts: 0
        };

        if (this.storeTransaction(transaction)) {
          migrated++;
        }
      } catch (error) {
        console.error('Failed to migrate legacy transaction:', error);
      }
    }

    return migrated;
  }

  private generateTransactionId(): string {
    return `EMV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}