import { TLVParser } from './tlv-parser';
import { ApplicationSelector } from './application-selector';
import { OfflineDataAuthentication, AuthenticationResult } from './offline-data-authentication';
import { TerminalRiskManagement } from './terminal-risk-management';
import { CardRiskManagement } from './card-risk-management';
import { CVMProcessor } from './cvm-processor';
import { ActionCodeProcessor } from './action-code-processor';
import { CryptogramGenerator } from './cryptogram-generator';
import { OfflineTransactionStorage, EMVTransaction } from './offline-storage';

export interface EMVTransactionInput {
  cardData: string;
  amount: number;
  currency: string;
  terminalData: string;
  pinEntered?: string;
  transactionType: string;
  terminalCountryCode: string;
  merchantCategoryCode: string;
  terminalType: string;
}

export interface EMVTransactionResult {
  success: boolean;
  approved: boolean;
  requiresOnline: boolean;
  decline: boolean;
  transactionId: string;
  reason: string;
  emvData: {
    application?: any;
    authentication?: AuthenticationResult;
    risk?: any;
    cvm?: any;
    actionCodes?: any;
    cryptogram?: any;
  };
  offlineTransaction?: EMVTransaction;
}

export class EMVOfflineTransactionEngine {
  private tlvParser: TLVParser;
  private applicationSelector: ApplicationSelector;
  private offlineDataAuthentication: OfflineDataAuthentication;
  private terminalRiskManagement: TerminalRiskManagement;
  private cardRiskManagement: CardRiskManagement;
  private cvmProcessor: CVMProcessor;
  private actionCodeProcessor: ActionCodeProcessor;
  private cryptogramGenerator: CryptogramGenerator;
  private offlineStorage: OfflineTransactionStorage;

  constructor(capks: any[] = []) {
    this.tlvParser = new TLVParser();
    this.applicationSelector = new ApplicationSelector();
    this.offlineDataAuthentication = new OfflineDataAuthentication(capks);
    this.terminalRiskManagement = new TerminalRiskManagement();
    this.cardRiskManagement = new CardRiskManagement();
    this.cvmProcessor = new CVMProcessor();
    this.actionCodeProcessor = new ActionCodeProcessor();
    this.cryptogramGenerator = new CryptogramGenerator();
    this.offlineStorage = new OfflineTransactionStorage();
  }

  processTransaction(input: EMVTransactionInput): EMVTransactionResult {
    try {
      // Step 1: Parse card data
      const cardTags = this.tlvParser.parseTLV(input.cardData);
      
      // Step 2: Select application
      const application = this.selectApplication(input.cardData);
      if (!application) {
        return this.createErrorResult('Application selection failed');
      }

      // Step 3: Perform offline data authentication
      const authentication = this.offlineDataAuthentication.authenticate(input.cardData, input.terminalData);
      if (!authentication.success) {
        return this.createDeclineResult('Authentication failed', authentication);
      }

      // Step 4: Terminal risk management
      const terminalRisk = this.terminalRiskManagement.checkTransaction(input.cardData, input.amount);
      if (!terminalRisk.proceed) {
        return this.createTerminalRiskResult(terminalRisk);
      }

      // Step 5: Card risk management
      const cardRisk = this.cardRiskManagement.checkCardRisk(input.cardData, input.amount);
      if (cardRisk.decline) {
        return this.createCardDeclineResult(cardRisk);
      }

      // Step 6: CVM Processing
      const cvmResult = this.cvmProcessor.process(input.cardData, input.pinEntered);
      if (!cvmResult.success) {
        return this.createCVMDeclineResult(cvmResult);
      }

      // Step 7: Action Code Evaluation
      const actionCodes = this.actionCodeProcessor.evaluateActionCodes(
        input.cardData,
        input.terminalData,
        {
          amount: input.amount,
          currencyCode: input.currency,
          terminalCountryCode: input.terminalCountryCode,
          transactionType: input.transactionType,
          terminalType: input.terminalType
        }
      );

      // Step 8: Determine final decision and generate cryptogram
      const finalDecision = this.determineFinalDecision(terminalRisk, cardRisk, actionCodes);
      const cryptogram = this.cryptogramGenerator.generateCryptogram({
        decision: finalDecision,
        reason: this.getDecisionReason(terminalRisk, cardRisk, actionCodes),
        cardData: input.cardData,
        terminalData: input.terminalData,
        amount: input.amount,
        currency: input.currency,
        transactionType: input.transactionType
      });

      // Step 9: Create offline transaction record
      const transactionId = this.generateTransactionId();
      const offlineTransaction = this.createOfflineTransaction(transactionId, input, {
        application,
        authentication,
        terminalRisk,
        cardRisk,
        cvm: cvmResult,
        actionCodes,
        cryptogram
      });

      // Step 10: Store transaction
      this.offlineStorage.storeTransaction(offlineTransaction);

      // Step 11: Update risk management counters
      if (finalDecision === 'TC') {
        this.cardRiskManagement.recordOfflineTransaction(input.amount);
      }

      return {
        success: true,
        approved: finalDecision === 'TC',
        requiresOnline: finalDecision === 'ARQC',
        decline: finalDecision === 'AAC',
        transactionId,
        reason: this.getDecisionReason(terminalRisk, cardRisk, actionCodes),
        emvData: {
          application,
          authentication,
          risk: { terminal: terminalRisk, card: cardRisk },
          cvm: cvmResult,
          actionCodes,
          cryptogram
        },
        offlineTransaction
      };

    } catch (error) {
      return this.createErrorResult(`Transaction processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private selectApplication(cardData: string): any {
    try {
      const terminalAIDs = [
        'A0000000041010', // Visa Debit
        'A0000000043060', // Visa Credit
        'A0000000031010', // Mastercard Debit
        'A0000000032010', // Mastercard Credit
        'A00000002501', // American Express
        'A0000000651010' // Discover
      ];

      return this.applicationSelector.selectApplication(cardData, terminalAIDs);
    } catch (error) {
      console.error('Application selection error:', error);
      return null;
    }
  }

  private determineFinalDecision(
    terminalRisk: any,
    cardRisk: any,
    actionCodes: any
  ): 'TC' | 'AAC' | 'ARQC' {
    // Priority order for decision making
    if (actionCodes.decision === 'DECLINE') return 'AAC';
    if (cardRisk.decline) return 'AAC';
    if (terminalRisk.requiresOnline || cardRisk.requiresOnline || actionCodes.decision === 'ONLINE') return 'ARQC';
    if (actionCodes.decision === 'APPROVE') return 'TC';
    
    // Default to online if uncertain
    return 'ARQC';
  }

  private getDecisionReason(terminalRisk: any, cardRisk: any, actionCodes: any): string {
    if (actionCodes.reason) return actionCodes.reason;
    if (cardRisk.reason) return cardRisk.reason;
    if (terminalRisk.reason) return terminalRisk.reason;
    return 'Transaction processed successfully';
  }

  private createOfflineTransaction(
    transactionId: string,
    input: EMVTransactionInput,
    emvData: any
  ): EMVTransaction {
    return {
      id: transactionId,
      timestamp: new Date(),
      amount: input.amount,
      currency: input.currency,
      cardData: input.cardData,
      terminalData: input.terminalData,
      application: emvData.application,
      authentication: {
        method: emvData.authentication.method,
        success: emvData.authentication.success,
        certificate: emvData.authentication.certificate
      },
      risk: {
        terminal: {
          proceed: emvData.terminalRisk.proceed,
          reason: emvData.terminalRisk.reason,
          requiresOnline: emvData.terminalRisk.requiresOnline
        },
        card: {
          proceed: emvData.cardRisk.proceed,
          reason: emvData.cardRisk.reason,
          requiresOnline: emvData.cardRisk.requiresOnline,
          decline: emvData.cardRisk.decline
        }
      },
      cvm: {
        method: emvData.cvm.method,
        result: emvData.cvm.success,
        pinVerified: emvData.cvm.pinVerified
      },
      actionCodes: emvData.actionCodes,
      cryptogram: emvData.cryptogram,
      terminalVerificationResults: this.generateTVR(emvData),
      transactionStatusInformation: this.generateTSI(emvData),
      offlineApproved: emvData.cryptogram.decision === 'TC',
      uploaded: false,
      uploadAttempts: 0
    };
  }

  private generateTVR(emvData: any): string {
    // Generate Terminal Verification Results based on EMV data
    // This is a simplified implementation
    let tvr = '0000000000';
    
    if (!emvData.authentication.success) tvr = this.setTVRBit(tvr, 1, 8); // Offline data authentication failed
    if (emvData.terminalRisk.requiresOnline) tvr = this.setTVRBit(tvr, 2, 8); // Transaction exceeds floor limit
    if (emvData.cardRisk.decline) tvr = this.setTVRBit(tvr, 3, 8); // Card risk management failed
    if (!emvData.cvm.success) tvr = this.setTVRBit(tvr, 4, 8); // CVM failed
    
    return tvr;
  }

  private generateTSI(emvData: any): string {
    // Generate Transaction Status Information
    let tsi = '0000';
    
    if (emvData.authentication.success) tsi = this.setTSIBit(tsi, 1, 8); // Offline data authentication performed
    if (emvData.terminalRisk.proceed) tsi = this.setTSIBit(tsi, 2, 8); // Terminal risk management performed
    if (emvData.cardRisk.proceed) tsi = this.setTSIBit(tsi, 3, 8); // Card risk management performed
    if (emvData.cvm.success) tsi = this.setTSIBit(tsi, 4, 8); // CVM processing performed
    
    return tsi;
  }

  private setTVRBit(tvr: string, byteIndex: number, bitPosition: number): string {
    const bytes = tvr.match(/.{2}/g) || [];
    if (byteIndex > 0 && byteIndex <= bytes.length) {
      const byte = parseInt(bytes[byteIndex - 1], 16);
      const newByte = byte | (1 << (bitPosition - 1));
      bytes[byteIndex - 1] = newByte.toString(16).padStart(2, '0').toUpperCase();
    }
    return bytes.join('');
  }

  private setTSIBit(tsi: string, byteIndex: number, bitPosition: number): string {
    const bytes = tsi.match(/.{2}/g) || [];
    if (byteIndex > 0 && byteIndex <= bytes.length) {
      const byte = parseInt(bytes[byteIndex - 1], 16);
      const newByte = byte | (1 << (bitPosition - 1));
      bytes[byteIndex - 1] = newByte.toString(16).padStart(2, '0').toUpperCase();
    }
    return bytes.join('');
  }

  private generateTransactionId(): string {
    return `EMV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private createErrorResult(reason: string): EMVTransactionResult {
    return {
      success: false,
      approved: false,
      requiresOnline: false,
      decline: true,
      transactionId: this.generateTransactionId(),
      reason,
      emvData: {},
      offlineTransaction: undefined
    };
  }

  private createDeclineResult(reason: string, authentication?: AuthenticationResult): EMVTransactionResult {
    return {
      success: true,
      approved: false,
      requiresOnline: false,
      decline: true,
      transactionId: this.generateTransactionId(),
      reason,
      emvData: { authentication },
      offlineTransaction: undefined
    };
  }

  private createTerminalRiskResult(terminalRisk: any): EMVTransactionResult {
    return {
      success: true,
      approved: false,
      requiresOnline: terminalRisk.requiresOnline,
      decline: false,
      transactionId: this.generateTransactionId(),
      reason: terminalRisk.reason,
      emvData: { risk: { terminal: terminalRisk } },
      offlineTransaction: undefined
    };
  }

  private createCardDeclineResult(cardRisk: any): EMVTransactionResult {
    return {
      success: true,
      approved: false,
      requiresOnline: false,
      decline: true,
      transactionId: this.generateTransactionId(),
      reason: cardRisk.reason,
      emvData: { risk: { card: cardRisk } },
      offlineTransaction: undefined
    };
  }

  private createCVMDeclineResult(cvmResult: any): EMVTransactionResult {
    return {
      success: true,
      approved: false,
      requiresOnline: false,
      decline: true,
      transactionId: this.generateTransactionId(),
      reason: 'Cardholder verification failed',
      emvData: { cvm: cvmResult },
      offlineTransaction: undefined
    };
  }

  // Public methods for configuration and management
  getStorage(): OfflineTransactionStorage {
    return this.offlineStorage;
  }

  getAuthentication(): OfflineDataAuthentication {
    return this.offlineDataAuthentication;
  }

  getRiskManagement(): {
    terminal: TerminalRiskManagement;
    card: CardRiskManagement;
  } {
    return {
      terminal: this.terminalRiskManagement,
      card: this.cardRiskManagement
    };
  }

  getCVMProcessor(): CVMProcessor {
    return this.cvmProcessor;
  }

  getCryptogramGenerator(): CryptogramGenerator {
    return this.cryptogramGenerator;
  }
}