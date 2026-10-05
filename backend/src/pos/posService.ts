import { issuerClient } from '../issuer/issuerClient';
import { bridgeService } from '../settlement/bridgeService';
import { PosProtocol } from '../core/PosProtocol';
import type { PosCard, PosProcessor, PosTerminal } from './models';
import { pos1011Validator } from './pos1011Validator';
import { v4 as uuidv4 } from 'uuid';
import { recordPosLedgerEvent } from './ledger';

export type Pos1011SaleRequest = {
  amountMinor: number;
  currency: string;
  card: PosCard;
  terminal: PosTerminal;
  processor: PosProcessor;
  pin: string;
};

export class PosService {
  async processPos1011Sale(request: Pos1011SaleRequest) {
    pos1011Validator.validateIntake(request);
    const currency = String(request.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error('ISO currency is required');
    const transactionId = uuidv4();
    await recordPosLedgerEvent('POS_SALE', request.amountMinor, currency, {
      terminalId: request.terminal.id,
      cardProgram: request.card.program || null,
      protocol: PosProtocol.POS_101_1,
    }, transactionId);

    const auth = await issuerClient.authorize({
      panToken: request.card.panToken,
      amountMinor: request.amountMinor,
      currency,
      protocol: PosProtocol.POS_101_1,
    });
    await recordPosLedgerEvent('ISSUER_AUTH', request.amountMinor, currency, {
      approved: auth.approved,
      authCode: auth.authCode || null,
      providerReference: auth.providerReference || null,
    }, transactionId);
    if (!auth.approved) return { status: 'DECLINED' as const, auth };

    const bridgeResult = await bridgeService.settleToUsdt({
      amountMinor: request.amountMinor,
      sourceCurrency: currency,
      protocol: PosProtocol.POS_101_1,
      authorizationReference: auth.providerReference || auth.authCode || '',
    });
    if (bridgeResult.status === 'SETTLED') {
      await recordPosLedgerEvent('BRIDGE_SETTLEMENT', bridgeResult.amountMinor, 'USDT', {
        sourceCurrency: currency,
        protocol: PosProtocol.POS_101_1,
        status: bridgeResult.status,
      }, transactionId);
      await recordPosLedgerEvent('PAYOUT', bridgeResult.amountMinor, 'USDT', {
        protocol: PosProtocol.POS_101_1,
      }, transactionId);
    }
    if (bridgeResult.status !== 'SETTLED') {
      return { status: 'PENDING_SETTLEMENT' as const, auth, bridgeResult };
    }
    return { status: 'APPROVED' as const, auth, bridgeResult };
  }
}

export const posService = new PosService();
