import {
  IsoAccountParty,
  IsoRemittance,
  XML_DECLARATION,
  accountXml,
  agentXml,
  ccyAmount,
  count,
  decimal,
  element,
  escapeXml,
  isoDate,
  isoDateTime,
  optionalOneOf,
  partyXml,
  remittanceXml,
  txt,
  uuidV4,
} from './xml.util';
import { BuiltIso20022Message, getMessageSchema } from './messageSchemas';

/**
 * pain.007.001.13 — CustomerPaymentReversalV13
 *
 * Document / CstmrPmtRvsl
 *   GrpHdr              GroupHeader124        MsgId, CreDtTm, Authstn*, NbOfTxs, CtrlSum?, GrpRvsl?, InitgPty?, ...
 *   OrgnlGrpInf         OriginalGroupHeader20 OrgnlMsgId, OrgnlMsgNmId, OrgnlCreDtTm?, RvslRsnInf*
 *   OrgnlPmtInfAndRvsl* OriginalPaymentInstruction53
 *   SplmtryData*
 */

const CHARGE_BEARERS = ['DEBT', 'CRED', 'SHAR', 'SLEV'] as const;

export interface ReversalReasonInput {
  /** PaymentReversalReason10/Orgtr */
  originator?: IsoAccountParty;
  /** ReversalReason4Choice/Cd (ExternalReversalReason1Code) */
  code?: string;
  /** ReversalReason4Choice/Prtry (Max35Text) */
  proprietary?: string;
  /** AddtlInf (Max105Text, unbounded) */
  additionalInformation?: string[];
}

export interface Pain007TransactionInput {
  /** RvslId (Max35Text) */
  reversalId?: string;
  originalInstructionId?: string;
  originalEndToEndId?: string;
  originalUetr?: string;
  originalInstructedAmount?: { amount: number; currency: string };
  reversedInstructedAmount?: { amount: number; currency: string };
  chargeBearer?: string;
  reversalReasons?: ReversalReasonInput[];
  /** OriginalTransactionReference47 sub-set. */
  originalTransactionReference?: {
    instructedAmount?: { amount: number; currency: string };
    interbankSettlementAmount?: { amount: number; currency: string };
    requestedExecutionDate?: string;
    debtorAccount?: IsoAccountParty;
    debtorAgent?: IsoAccountParty;
    creditorAgent?: IsoAccountParty;
    creditorAccount?: IsoAccountParty;
    remittance?: IsoRemittance;
  };
}

export interface Pain007PaymentInstructionInput {
  /** RvslPmtInfId (Max35Text) */
  reversalPaymentInfoId?: string;
  originalPaymentInfoId: string;
  originalNumberOfTransactions?: number;
  originalControlSum?: number;
  batchBooking?: boolean;
  paymentInfoReversal?: boolean;
  reversalReasons?: ReversalReasonInput[];
  transactions?: Pain007TransactionInput[];
}

export interface Pain007Input {
  messageId?: string;
  creationDateTime?: Date;
  /** GrpHdr/NbOfTxs — defaults to the number of supplied transactions. */
  numberOfTransactions?: number;
  controlSum?: number;
  groupReversal?: boolean;
  initiatingParty?: IsoAccountParty;
  originalMessageId: string;
  originalMessageNameId: string;
  originalCreationDateTime?: string;
  reversalReasons?: ReversalReasonInput[];
  paymentInstructions?: Pain007PaymentInstructionInput[];
}

export function buildPain007Xml(input: Pain007Input): BuiltIso20022Message {
  const schema = getMessageSchema('pain.007.001.13');
  if (!input?.originalMessageId) throw new Error('pain.007.001.13 requires originalMessageId (OrgnlGrpInf/OrgnlMsgId)');
  if (!input?.originalMessageNameId) throw new Error('pain.007.001.13 requires originalMessageNameId (OrgnlGrpInf/OrgnlMsgNmId)');

  const now = input.creationDateTime instanceof Date ? input.creationDateTime : new Date();
  const creationDateTime = isoDateTime(now);
  const messageId = input.messageId
    ? txt(input.messageId, 35, 'GrpHdr.MsgId')
    : escapeXml(`PS-REVERSAL-${now.getTime().toString(36).toUpperCase()}`);

  const instructions = Array.isArray(input.paymentInstructions) ? input.paymentInstructions : [];
  let transactionCount = 0;
  let controlSum = 0;
  let controlCurrency: string | null = null;
  let mixedCurrency = false;

  const instructionXml = instructions.map((instruction, index) => {
    const at = `paymentInstructions[${index}]`;
    if (!instruction?.originalPaymentInfoId) throw new Error(`${at}.originalPaymentInfoId is required`);
    const transactions = Array.isArray(instruction.transactions) ? instruction.transactions : [];

    const txXml = transactions.map((tx, txIndex) => {
      transactionCount += 1;
      const reversed = tx.reversedInstructedAmount || tx.originalInstructedAmount;
      if (reversed) {
        controlSum += Number(reversed.amount);
        const ccy = String(reversed.currency || '').toUpperCase();
        if (controlCurrency === null) controlCurrency = ccy;
        else if (controlCurrency !== ccy) mixedCurrency = true;
      }
      return buildReversalTransaction(tx, `${at}.transactions[${txIndex}]`);
    }).join('\n');

    return (
      `    <OrgnlPmtInfAndRvsl>\n` +
      `${element('RvslPmtInfId', instruction.reversalPaymentInfoId ? txt(instruction.reversalPaymentInfoId, 35, `${at}.reversalPaymentInfoId`) : '', '      ')}${instruction.reversalPaymentInfoId ? '\n' : ''}` +
      `${element('OrgnlPmtInfId', txt(instruction.originalPaymentInfoId, 35, `${at}.originalPaymentInfoId`), '      ')}\n` +
      `${instruction.originalNumberOfTransactions === undefined ? '' : `${element('OrgnlNbOfTxs', count(instruction.originalNumberOfTransactions, 'OrgnlNbOfTxs'), '      ')}\n`}` +
      `${instruction.originalControlSum === undefined ? '' : `${element('OrgnlCtrlSum', decimal(Number(instruction.originalControlSum), 5, 'OrgnlCtrlSum'), '      ')}\n`}` +
      `${instruction.batchBooking === undefined ? '' : `${element('BtchBookg', instruction.batchBooking ? 'true' : 'false', '      ')}\n`}` +
      `${instruction.paymentInfoReversal === undefined ? '' : `${element('PmtInfRvsl', instruction.paymentInfoReversal ? 'true' : 'false', '      ')}\n`}` +
      `${reversalReasonXml(instruction.reversalReasons, '      ')}` +
      `${txXml}${txXml ? '\n' : ''}` +
      `    </OrgnlPmtInfAndRvsl>`
    );
  }).join('\n');

  const numberOfTransactions = input.numberOfTransactions !== undefined
    ? Number(input.numberOfTransactions)
    : transactionCount;
  const controlSumValue = input.controlSum !== undefined
    ? Number(input.controlSum)
    : (mixedCurrency || controlCurrency === null ? null : Number(controlSum.toFixed(5)));

  const xml =
    `${XML_DECLARATION}\n` +
    `<Document xmlns="${schema.namespace}">\n` +
    `  <CstmrPmtRvsl>\n` +
    `    <GrpHdr>\n` +
    `${element('MsgId', messageId, '      ')}\n` +
    `${element('CreDtTm', creationDateTime, '      ')}\n` +
    `${element('NbOfTxs', count(numberOfTransactions), '      ')}\n` +
    `${controlSumValue === null ? '' : `${element('CtrlSum', decimal(controlSumValue, 5, 'GrpHdr.CtrlSum'), '      ')}\n`}` +
    `${input.groupReversal === undefined ? '' : `${element('GrpRvsl', input.groupReversal ? 'true' : 'false', '      ')}\n`}` +
    `${input.initiatingParty ? `${partyXml('InitgPty', input.initiatingParty, '      ')}\n` : ''}` +
    `    </GrpHdr>\n` +
    `    <OrgnlGrpInf>\n` +
    `${element('OrgnlMsgId', txt(input.originalMessageId, 35, 'OrgnlGrpInf.OrgnlMsgId'), '      ')}\n` +
    `${element('OrgnlMsgNmId', txt(input.originalMessageNameId, 35, 'OrgnlGrpInf.OrgnlMsgNmId'), '      ')}\n` +
    `${element('OrgnlCreDtTm', input.originalCreationDateTime ? isoDateTime(new Date(input.originalCreationDateTime)) : '', '      ')}${input.originalCreationDateTime ? '\n' : ''}` +
    `${reversalReasonXml(input.reversalReasons, '      ')}` +
    `    </OrgnlGrpInf>\n` +
    `${instructionXml}${instructionXml ? '\n' : ''}` +
    `  </CstmrPmtRvsl>\n` +
    `</Document>\n`;

  return {
    messageType: 'pain.007.001.13',
    messageName: schema.messageName,
    messageId,
    creationDateTime,
    numberOfTransactions,
    controlSum: controlSumValue,
    currency: mixedCurrency ? null : controlCurrency,
    initiatingParty: input.initiatingParty?.name ? String(input.initiatingParty.name) : null,
    xml,
  };
}

function buildReversalTransaction(tx: Pain007TransactionInput, at: string): string {
  if (!tx || typeof tx !== 'object') throw new Error(`${at} is not an object`);
  if (!tx.originalInstructionId && !tx.originalEndToEndId && !tx.originalUetr) {
    throw new Error(`${at} must identify the original transaction (originalInstructionId, originalEndToEndId or originalUetr)`);
  }

  const chargeBearer = optionalOneOf(tx.chargeBearer, CHARGE_BEARERS, `${at}.chargeBearer`);
  const uetr = tx.originalUetr ? uuidV4(tx.originalUetr, `${at}.originalUetr`) : '';

  const originalAmount = tx.originalInstructedAmount
    ? `        ${ccyAmount('OrgnlInstdAmt', tx.originalInstructedAmount.currency, Number(tx.originalInstructedAmount.amount), `${at}.originalInstructedAmount.amount`)}\n`
    : '';
  const reversedAmount = tx.reversedInstructedAmount
    ? `        ${ccyAmount('RvsdInstdAmt', tx.reversedInstructedAmount.currency, Number(tx.reversedInstructedAmount.amount), `${at}.reversedInstructedAmount.amount`)}\n`
    : '';

  const reference = tx.originalTransactionReference;
  let referenceXml = '';
  if (reference) {
    const parts: string[] = [];
    if (reference.interbankSettlementAmount) {
      parts.push(`      ${ccyAmount('IntrBkSttlmAmt', reference.interbankSettlementAmount.currency, Number(reference.interbankSettlementAmount.amount), `${at}.originalTransactionReference.interbankSettlementAmount.amount`)}`);
    }
    if (reference.instructedAmount) {
      parts.push(`      <Amt>\n        ${ccyAmount('InstdAmt', reference.instructedAmount.currency, Number(reference.instructedAmount.amount), `${at}.originalTransactionReference.instructedAmount.amount`)}\n      </Amt>`);
    }
    if (reference.requestedExecutionDate) {
      parts.push(`      <ReqdExctnDt>\n        <Dt>${isoDate(reference.requestedExecutionDate, `${at}.originalTransactionReference.requestedExecutionDate`)}</Dt>\n      </ReqdExctnDt>`);
    }
    const remittance = remittanceXml(reference.remittance, '      ');
    if (remittance) parts.push(remittance);
    if (reference.debtorAccount) parts.push(accountXml('DbtrAcct', reference.debtorAccount, '      '));
    if (reference.debtorAgent) parts.push(agentXml('DbtrAgt', reference.debtorAgent, '      '));
    if (reference.creditorAgent) parts.push(agentXml('CdtrAgt', reference.creditorAgent, '      '));
    if (reference.creditorAccount) parts.push(accountXml('CdtrAcct', reference.creditorAccount, '      '));
    if (parts.length) referenceXml = `        <OrgnlTxRef>\n${parts.join('\n')}\n        </OrgnlTxRef>\n`;
  }

  return (
    `      <TxInf>\n` +
    `${element('RvslId', tx.reversalId ? txt(tx.reversalId, 35, `${at}.reversalId`) : '', '        ')}${tx.reversalId ? '\n' : ''}` +
    `${element('OrgnlInstrId', tx.originalInstructionId ? txt(tx.originalInstructionId, 35, `${at}.originalInstructionId`) : '', '        ')}${tx.originalInstructionId ? '\n' : ''}` +
    `${element('OrgnlEndToEndId', tx.originalEndToEndId ? txt(tx.originalEndToEndId, 35, `${at}.originalEndToEndId`) : '', '        ')}${tx.originalEndToEndId ? '\n' : ''}` +
    `${element('OrgnlUETR', uetr, '        ')}${uetr ? '\n' : ''}` +
    `${originalAmount}${reversedAmount}` +
    `${element('ChrgBr', chargeBearer || '', '        ')}${chargeBearer ? '\n' : ''}` +
    `${reversalReasonXml(tx.reversalReasons, '        ')}` +
    `${referenceXml}` +
    `      </TxInf>`
  );
}

function reversalReasonXml(reasons: ReversalReasonInput[] | undefined, indent: string): string {
  if (!Array.isArray(reasons) || !reasons.length) return '';
  return reasons.map((reason, index) => {
    if (!reason || (!reason.code && !reason.proprietary)) {
      throw new Error(`reversalReasons[${index}] requires code or proprietary`);
    }
    const rsn = reason.code
      ? `<Cd>${txt(reason.code, 4, `reversalReasons[${index}].code`)}</Cd>`
      : `<Prtry>${txt(reason.proprietary, 35, `reversalReasons[${index}].proprietary`)}</Prtry>`;
    const additional = (reason.additionalInformation || [])
      .filter(Boolean)
      .map(line => element('AddtlInf', txt(line, 105, `reversalReasons[${index}].additionalInformation`), indent + '    '))
      .join('\n');
    return (
      `${indent}<RvslRsnInf>\n` +
      `${reason.originator ? `${partyXml('Orgtr', reason.originator, indent + '  ')}\n` : ''}` +
      `${indent}  <Rsn>${rsn}</Rsn>\n` +
      (additional ? `${additional}\n` : '') +
      `${indent}</RvslRsnInf>`
    );
  }).join('\n') + '\n';
}
