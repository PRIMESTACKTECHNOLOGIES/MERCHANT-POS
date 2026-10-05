import { TLVParser } from './tlv-parser';
import { ApplicationSelector } from './application-selector';
import type { ApplicationTemplate } from './application-selector';
import { OfflineDataAuthentication } from './offline-data-authentication';
import type { AuthenticationResult, CAPK } from './offline-data-authentication';
import { TerminalRiskManagement, type TerminalRiskResult } from './terminal-risk-management';
import { CardRiskManagement, type CardRiskResult } from './card-risk-management';
import { CVMProcessor, type CVMResult } from './cvm-processor';
import { ActionCodeProcessor, type ActionCodeResult } from './action-code-processor';
import { CryptogramGenerator, type CryptogramResult } from './cryptogram-generator';
import { OfflineTransactionStorage } from './offline-storage';
import type { EMVTransaction } from './offline-storage';
import { TVRTSIBuilder, type TVRContext, type TSIContext } from './tvr-tsi-builder';
import { ICCReader } from './icc-reader';
import { NFCReader } from './nfc-reader';
import { PinPad } from './pin-pad';
import { RecordReader } from './record-reader';
import { AIDSelector } from './aid-selector';
import { GPOHandler } from './gpo-handler';
import { EMVCardFlow } from './emv-card-flow';
import { ACCryptogramGenerator } from './ac-generator';
import type { ACResult } from './ac-generator';
import { IssuerScriptProcessor } from './issuer-script';
import type { ScriptResult, IssuerAuthResult } from './issuer-script';
import { OnlineAuth } from './online-auth';
import type { OnlineAuthRequest, OnlineAuthResponse } from './online-auth';
import { EMVStateMachine } from './emv-state-machine';
import type { EMVStateResult, EMVStateMachineConfig } from './emv-state-machine';
import { ContactlessKernel } from './contactless-kernel';
import type { CTLResult } from './contactless-kernel';
import { EMVRouter } from './emv-router';
import type { RouteResult, RouteConfig } from './emv-router';

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
    application?: ApplicationTemplate | null;
    authentication?: AuthenticationResult;
    risk?: { terminal?: TerminalRiskResult; card?: CardRiskResult };
    cvm?: CVMResult;
    actionCodes?: ActionCodeResult;
    cryptogram?: CryptogramResult;
    ac?: ACResult;
  };
  offlineTransaction?: EMVTransaction;
}

export class EMVOfflineTransactionEngine {
  private applicationSelector: ApplicationSelector;
  private offlineDataAuthentication: OfflineDataAuthentication;
  private terminalRiskManagement: TerminalRiskManagement;
  private cardRiskManagement: CardRiskManagement;
  private cvmProcessor: CVMProcessor;
  private actionCodeProcessor: ActionCodeProcessor;
  private cryptogramGenerator: CryptogramGenerator;
  private offlineStorage: OfflineTransactionStorage;
  private icc: ICCReader;
  private nfc: NFCReader;
  private pinPad: PinPad;
  private recordReader: RecordReader;
  private aidSelector: AIDSelector;
  private gpoHandler: GPOHandler;
  private cardFlow: EMVCardFlow;
  private acGenerator: ACCryptogramGenerator;
  private scriptProcessor: IssuerScriptProcessor;
  private onlineAuth: OnlineAuth;
  private stateMachine: EMVStateMachine;
  private ctlKernel: ContactlessKernel;
  private router: EMVRouter;

  constructor(capks: CAPK[] = []) {
    this.applicationSelector = new ApplicationSelector();
    this.offlineDataAuthentication = new OfflineDataAuthentication(capks);
    this.terminalRiskManagement = new TerminalRiskManagement();
    this.cardRiskManagement = new CardRiskManagement();
    this.cvmProcessor = new CVMProcessor();
    this.actionCodeProcessor = new ActionCodeProcessor();
    this.cryptogramGenerator = new CryptogramGenerator();
    this.offlineStorage = new OfflineTransactionStorage();
    this.icc = new ICCReader();
    this.nfc = new NFCReader();
    this.pinPad = new PinPad();
    this.recordReader = new RecordReader(this.icc.getBridge());
    this.aidSelector = new AIDSelector(this.icc.getBridge());
    this.gpoHandler = new GPOHandler(this.icc.getBridge());
    this.cardFlow = new EMVCardFlow(this.icc.getBridge());
    this.acGenerator = new ACCryptogramGenerator();
    this.scriptProcessor = new IssuerScriptProcessor(this.icc.getBridge());
    this.onlineAuth = new OnlineAuth();
    this.stateMachine = new EMVStateMachine(this.icc.getBridge(), capks);
    this.ctlKernel = new ContactlessKernel(this.nfc.getBridge());
    this.router = new EMVRouter(this.icc.getBridge(), this.nfc.getBridge(), capks);
  }

  /** Access the ICC (contact chip) reader */
  getICCReader(): ICCReader {
    return this.icc;
  }

  /** Access the NFC (contactless) reader */
  getNFCReader(): NFCReader {
    return this.nfc;
  }

  /** Access the PIN pad */
  getPinPad(): PinPad {
    return this.pinPad;
  }

  /** Access the Record Reader (AFL / READ RECORD) */
  getRecordReader(): RecordReader {
    return this.recordReader;
  }

  /** Access the AID Selector (PPSE / AID selection) */
  getAIDSelector(): AIDSelector {
    return this.aidSelector;
  }

  /** Access the GPO Handler */
  getGPOHandler(): GPOHandler {
    return this.gpoHandler;
  }

  /** Access the full EMV card flow wrapper */
  getCardFlow(): EMVCardFlow {
    return this.cardFlow;
  }

  /** Access the AC cryptogram generator */
  getACGenerator(): ACCryptogramGenerator {
    return this.acGenerator;
  }

  /** Access the Issuer Script processor */
  getScriptProcessor(): IssuerScriptProcessor {
    return this.scriptProcessor;
  }

  /** Access the Online Authorization builder */
  getOnlineAuth(): OnlineAuth {
    return this.onlineAuth;
  }

  /** Access the EMV L2 state machine controller */
  getStateMachine(): EMVStateMachine {
    return this.stateMachine;
  }

  /** Access the Contactless (NFC) kernel */
  getContactlessKernel(): ContactlessKernel {
    return this.ctlKernel;
  }

  /** Access the EMV Router (contact + contactless + magstripe) */
  getRouter(): EMVRouter {
    return this.router;
  }

  /**
   * Auto-route a transaction based on detected card interface.
   *
   * Automatically detects whether a contact (ICC) or contactless (NFC) card
   * is present and routes to the appropriate processing path:
   *   - CONTACT     → ICC chip → full EMV state machine
   *   - CONTACTLESS → NFC card → mode detection (qVSDC/EMV/MAG)
   *   - MAGSTRIPE   → NFC MSD mode → magstripe fallback
   *
   * @param config  Transaction configuration (amount, terminal data, PIN, etc.)
   * @returns       Routing result with full transaction outcome
   */
  async routeTransaction(config: RouteConfig): Promise<RouteResult> {
    return this.router.route(config);
  }

  /**
   * Run the contactless (NFC) EMV flow.
   *
   * Executes: PPSE → SELECT AID → GPO → READ RECORD → mode detection
   *
   * @param terminalTLVHex  Terminal data TLV (hex)
   * @param preferredAIDs   Optional preferred AIDs
   * @returns               Contactless flow result with detected mode (qVSDC/EMV/MAG)
   */
  async runContactless(terminalTLVHex: string, preferredAIDs?: string[]): Promise<CTLResult> {
    return this.ctlKernel.run(terminalTLVHex, preferredAIDs);
  }

  /**
   * Run the full EMV L2 state machine.
   *
   * Executes the complete flow:
   *   SELECT → GPO → READ RECORD → ODA → Risk → CVM → AC → [Online] → [Scripts]
   *
   * @param config  Transaction configuration (amount, terminal data, PIN, etc.)
   * @returns       Complete state machine result with decision + all step results
   */
  async runStateMachine(config: EMVStateMachineConfig): Promise<EMVStateResult> {
    return this.stateMachine.run(config);
  }

  /**
   * Build online authorization request from current transaction data.
   *
   * Creates the full EMV field block for the payment host:
   *   PAN, amount, currency, STAN, datetime, CID, AC, ATC, TVR, TSI, AIP, AID, IAD, UN
   *
   * @param cardTLVHex      Card data TLV (hex)
   * @param terminalTLVHex  Terminal data TLV (hex)
   * @param ac              AC cryptogram result
   * @param transactionType Transaction type code (default: '00' purchase)
   * @returns               Online authorization request
   */
  buildOnlineAuthRequest(
    cardTLVHex: string,
    terminalTLVHex: string,
    ac: ACResult,
    transactionType?: string
  ): OnlineAuthRequest {
    return this.onlineAuth.build(cardTLVHex, terminalTLVHex, ac, transactionType);
  }

  /**
   * Process issuer authorization response.
   *
   * Parses the response and executes issuer scripts:
   *   1. Parse ARC (tag 8A) + issuer data (tag 91) + scripts (tags 71/72)
   *   2. Execute EXTERNAL AUTHENTICATE (tag 91)
   *   3. Execute issuer scripts (tags 71/72)
   *
   * @param responseHex  Issuer response TLV (hex)
   * @returns            Parsed response + script execution results
   */
  async processOnlineResponse(responseHex: string): Promise<{
    response: OnlineAuthResponse;
    auth: IssuerAuthResult;
    scripts: ScriptResult;
  }> {
    const response = this.onlineAuth.parseResponse(responseHex);
    const { auth, scripts } = await this.scriptProcessor.processFullResponse(responseHex);
    return { response, auth, scripts };
  }

  /**
   * Process issuer authorization response after online ARQC.
   *
   * Handles:
   *   - Tag 91: Issuer Authentication Data → EXTERNAL AUTHENTICATE
   *   - Tag 71: Issuer Script Template 1 (before 2nd GENERATE AC)
   *   - Tag 72: Issuer Script Template 2 (after 2nd GENERATE AC)
   *
   * @param issuerResponseHex  Issuer response TLV (hex)
   * @returns                  Authentication + script execution results
   */
  async processIssuerResponse(issuerResponseHex: string): Promise<{
    auth: IssuerAuthResult;
    scripts: ScriptResult;
  }> {
    return this.scriptProcessor.processFullResponse(issuerResponseHex);
  }


  async processTransaction(input: EMVTransactionInput): Promise<EMVTransactionResult> {
    try {
      // Step 1: Parse card data
      // Step 2: Select application
      const application = this.selectApplication(input.cardData);
      if (!application) {
        return this.createErrorResult('Application selection failed');
      }

      // Step 3: Perform offline data authentication
      const authentication = await this.offlineDataAuthentication.authenticate(input.cardData, input.terminalData);
      if (!authentication.success) {
        const declineReason =
          authentication.error ||
          'Authentication failed';
        return this.createDeclineResult(declineReason, authentication);
      }

      // Step 4: Terminal risk management
      const terminalRisk = this.terminalRiskManagement.evaluate(input.cardData, input.amount);
      if (!terminalRisk.proceed) {
        return this.createTerminalRiskResult(terminalRisk);
      }

      // Step 5: Card risk management
      const cardRisk = this.cardRiskManagement.checkCardRisk(input.cardData, input.amount);
      if (cardRisk.decline) {
        return this.createCardDeclineResult(cardRisk);
      }

      // Step 6: CVM Processing
      const cvmResult = await this.cvmProcessor.process(input.cardData, input.pinEntered, this.pinPad);
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
        transactionData: {
          amount: input.amount,
          currencyCode: input.currency,
          terminalCountryCode: input.terminalCountryCode,
          transactionType: input.transactionType,
          terminalType: input.terminalType,
          transactionDate: new Date().toISOString().slice(2,10).replace(/-/g,''),
          transactionTime: new Date().toTimeString().slice(0,8).replace(/:/g,''),
          unpredictableNumber: Math.floor(Math.random()*0xFFFFFFFF).toString(16).padStart(8,'0').toUpperCase(),
        }
      });

      // Step 8b: Generate real AC cryptogram (ARQC / TC / AAC)
      const acType = finalDecision === 'ARQC' ? 'ARQC' : finalDecision === 'TC' ? 'TC' : 'AAC';
      const acResult: ACResult = await this.acGenerator.generateAC(
        input.cardData,
        input.terminalData,
        acType
      );

      // Step 9: Create offline transaction record
      const transactionId = this.generateTransactionId();
      const offlineTransaction = this.createOfflineTransaction(transactionId, input, {
        application,
        authentication,
        terminalRisk,
        cardRisk,
        cvm: cvmResult,
        actionCodes,
        cryptogram,
        ac: acResult
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
          cryptogram,
          ac: acResult
        },
        offlineTransaction
      };

    } catch (error) {
      return this.createErrorResult(`Transaction processing error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private selectApplication(cardData: string): ApplicationTemplate | null {
    try {
      const terminalAIDs = [
        'A0000000041010', // Visa Debit
        'A0000000043060', // Visa Credit
        'A0000000031010', // Mastercard Debit
        'A0000000032010', // Mastercard Credit
        'A00000002501', // American Express
        'A0000000651010' // Discover
      ];

      return ApplicationSelector.selectApplication(cardData, terminalAIDs);
    } catch (error) {
      console.error('Application selection error:', error);
      return null;
    }
  }

  private determineFinalDecision(
    terminalRisk: TerminalRiskResult,
    cardRisk: CardRiskResult,
    actionCodes: ActionCodeResult
  ): 'TC' | 'AAC' | 'ARQC' {
    // Priority order for decision making
    if (actionCodes.decision === 'DECLINE') return 'AAC';
    if (cardRisk.decline) return 'AAC';
    if (terminalRisk.requiresOnline || cardRisk.requiresOnline || actionCodes.decision === 'ONLINE') return 'ARQC';
    if (actionCodes.decision === 'APPROVE') return 'TC';
    
    // Default to online if uncertain
    return 'ARQC';
  }

  private getDecisionReason(terminalRisk: TerminalRiskResult, cardRisk: CardRiskResult, actionCodes: ActionCodeResult): string {
    if (actionCodes.reason) return actionCodes.reason;
    if (cardRisk.reason) return cardRisk.reason;
    if (terminalRisk.reason) return terminalRisk.reason;
    return 'Transaction processed successfully';
  }

  private createOfflineTransaction(
    transactionId: string,
    input: EMVTransactionInput,
    emvData: {
      application: ApplicationTemplate;
      authentication: AuthenticationResult;
      terminalRisk: TerminalRiskResult;
      cardRisk: CardRiskResult;
      cvm: CVMResult;
      actionCodes: ActionCodeResult;
      cryptogram: CryptogramResult;
      ac: ACResult;
    }
  ): EMVTransaction {
    return {
      id: transactionId,
      timestamp: new Date(),
      amount: input.amount,
      currency: input.currency,
      cardData: input.cardData,
      terminalData: input.terminalData,
      application: emvData.application
        ? {
            aid: emvData.application.aid,
            label: emvData.application.applicationLabel || emvData.application.name,
            priority: emvData.application.priority,
          }
        : { aid: 'A0000000041010', label: 'VISA', priority: 1 },
      authentication: {
        method: emvData.authentication?.method || 'SDA',
        success: emvData.authentication?.success ?? true,
        certificate: emvData.authentication?.certificate
      },
      risk: {
        terminal: {
          proceed: emvData.terminalRisk?.proceed ?? true,
          reason: emvData.terminalRisk?.reason,
          requiresOnline: emvData.terminalRisk?.requiresOnline ?? false
        },
        card: {
          proceed: emvData.cardRisk?.proceed ?? true,
          reason: emvData.cardRisk?.reason,
          requiresOnline: emvData.cardRisk?.requiresOnline ?? false,
          decline: emvData.cardRisk?.decline ?? false
        }
      },
      cvm: {
        method: emvData.cvm?.method || 'NO_CVM',
        result: emvData.cvm?.success ?? true,
        pinVerified: emvData.cvm?.pinVerified
      },
      actionCodes: emvData.actionCodes || { decision: 'APPROVE', reason: 'Default' },
      cryptogram: emvData.cryptogram || { decision: 'TC', cryptogram: '0000000000000000', reason: '' },
      terminalVerificationResults: this.generateTVR(
        emvData.authentication, emvData.cvm, emvData.terminalRisk, emvData.cardRisk, input.cardData
      ),
      transactionStatusInformation: this.generateTSI(
        emvData.authentication, emvData.cvm, emvData.terminalRisk, emvData.cardRisk, emvData.cryptogram?.decision || 'TC'
      ),
      offlineApproved: emvData.cryptogram?.decision === 'TC',
      uploaded: false,
      uploadAttempts: 0
    };
  }

  private generateTVR(authentication: AuthenticationResult, cvm: CVMResult, terminalRisk: TerminalRiskResult, cardRisk: CardRiskResult, cardData: string): string {
    const cardTags = TLVParser.parseTLV(cardData);
    const iccDataMissing = !TLVParser.getTagValue(cardTags, '5A');

    const tvrCtx: TVRContext = {
      // Byte 1 — ODA results
      odaPerformed: authentication?.success ?? false,
      odaFailed: !(authentication?.success ?? false),
      sdaSelected: authentication?.method === 'SDA',
      ddaFailed: authentication?.method === 'DDA' && !authentication?.success,
      cdaFailed: authentication?.method === 'CDA' && !authentication?.success,
      iccDataMissing,
      cardOnExceptionFile: false,

      // Byte 2 — CVM / card validity
      cardNotEffective: false,
      appExpired: false,
      appNotEffective: false,
      newCard: false,
      cvmFailed: !cvm?.success,
      unrecognisedCVM: cvm?.method === 'UNKNOWN',
      pinTryLimitExceeded: this.cvmProcessor.getPinAttempts() >= this.cvmProcessor['maxPinAttempts'],

      // Byte 3 — Terminal risk
      pinPadMissingOrBroken: false,
      pinRequiredNotEntered: !cvm?.pinVerified && cvm?.method === 'PIN',
      onlinePinEntered: false,
      exceedsFloorLimit: terminalRisk?.exceedsFloorLimit ?? false,
      lowerOfflineLimitExceeded: cardRisk?.exceededOfflineLimit ?? false,
      upperOfflineLimitExceeded: cardRisk?.decline ?? false,
      randomOnlineSelected: terminalRisk?.randomOnlineSelected ?? false,
      merchantForcedOnline: terminalRisk?.merchantForcedOnline ?? false,

      // Byte 4 — Issuer auth / script
      defaultTDOLUsed: false,
      issuerAuthFailed: false,
      scriptFailedBeforeFinalAC: false,
      scriptFailedAfterFinalAC: false,
    };

    return TVRTSIBuilder.buildTVR(tvrCtx);
  }

  private generateTSI(authentication: AuthenticationResult, cvm: CVMResult, terminalRisk: TerminalRiskResult, cardRisk: CardRiskResult, cryptogramDecision: string): string {
    const tsiCtx: TSIContext = {
      offlineDataAuthenticationPerformed: authentication?.success ?? false,
      cardholderVerificationPerformed: cvm?.success ?? false,
      cardRiskManagementPerformed: cardRisk?.proceed !== undefined,
      issuerAuthPerformed: cryptogramDecision === 'ARQC',
      scriptProcessingPerformed: false,
    };

    return TVRTSIBuilder.buildTSI(tsiCtx);
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

  private createTerminalRiskResult(terminalRisk: TerminalRiskResult): EMVTransactionResult {
    return {
      success: true,
      approved: false,
      requiresOnline: terminalRisk.requiresOnline,
      decline: false,
      transactionId: this.generateTransactionId(),
      reason: terminalRisk.reason ?? 'Terminal risk checks did not pass',
      emvData: { risk: { terminal: terminalRisk } },
      offlineTransaction: undefined
    };
  }

  private createCardDeclineResult(cardRisk: CardRiskResult): EMVTransactionResult {
    return {
      success: true,
      approved: false,
      requiresOnline: false,
      decline: true,
      transactionId: this.generateTransactionId(),
      reason: cardRisk.reason ?? 'Card risk checks did not pass',
      emvData: { risk: { card: cardRisk } },
      offlineTransaction: undefined
    };
  }

  private createCVMDeclineResult(cvmResult: CVMResult): EMVTransactionResult {
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