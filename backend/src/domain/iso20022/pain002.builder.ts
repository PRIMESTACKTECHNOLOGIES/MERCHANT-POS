import {
  IsoAccountParty,
  IsoRemittance,
  XML_DECLARATION,
  accountXml,
  agentXml,
  ccyAmount,
  count,
  currency as normCurrency,
  decimal,
  element,
  escapeXml,
  isoDate,
  isoDateTime,
  partyXml,
  remittanceXml,
  txt,
  uuidV4,
} from './xml.util';
import { BuiltIso20022Message, getMessageSchema } from './messageSchemas';

/**
 * pain.002.001.15 — CustomerPaymentStatusReportV15
 *
 * Document / CstmrPmtStsRpt
 *   GrpHdr               GroupHeader128        MsgId, CreDtTm, InitgPty?, FwdgAgt?, DbtrAgt?, CdtrAgt?
 *   OrgnlGrpInfAndSts    OriginalGroupHeader22 OrgnlMsgId, OrgnlMsgNmId, OrgnlCreDtTm?, OrgnlNbOfTxs?,
 *                                              OrgnlCtrlSum?, GrpSts?, StsRsnInf*, NbOfTxsPerSts*
 *   OrgnlPmtInfAndSts*   OriginalPaymentInstruction56
 *   SplmtryData*
 */

const STATUS_CODES = /^[A-Z0-9]{1,4}$/;

/** ISO 20022 external payment status codes (ExternalPaymentTransactionStatus1Code / ExternalPaymentGroupStatus1Code). */
export type PaymentStatusCode =
  | 'RCVD' | 'ACTC' | 'ACSP' | 'ACSC' | 'ACCC' | 'RJCT' | 'PDNG' | 'ACCP' | 'ACWC' | 'PART';

export interface StatusReasonInput {
  /** StatusReasonInformation14/Orgtr */
  originator?: IsoAccountParty;
  /** StatusReason6Choice/Cd (ExternalStatusReason1Code) */
  code?: string;
  /** StatusReason6Choice/Prtry (Max35Text) */
  proprietary?: string;
  /** AddtlInf (Max105Text, unbounded) */
  additionalInformation?: string[];
}

export interface Pain002TransactionStatusInput {
  /** StsId (Max35Text) */
  statusId?: string;
  originalInstructionId?: string;
  originalEndToEndId?: string;
  originalUetr?: string;
  transactionStatus?: string;
  statusReasons?: StatusReasonInput[];
  acceptedDateTime?: string;
  accountServicerReference?: string;
  clearingSystemReference?: string;
  /** OriginalTransactionReference47 sub-set used for reconciliation. */
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

export interface Pain002PaymentInstructionStatusInput {
  originalPaymentInfoId: string;
  originalNumberOfTransactions?: number;
  originalControlSum?: number;
  paymentInfoStatus?: string;
  statusReasons?: StatusReasonInput[];
  transactionsPerStatus?: Array<{ detailedNumberOfTransactions: number; detailedStatus: string; detailedControlSum?: number }>;
  transactions?: Pain002TransactionStatusInput[];
}

export interface Pain002Input {
  messageId?: string;
  creationDateTime?: Date;
  initiatingParty?: IsoAccountParty;
  /** OriginalGroupHeader22/OrgnlMsgId — the MsgId of the message being reported on. */
  originalMessageId: string;
  /** OriginalGroupHeader22/OrgnlMsgNmId — e.g. pain.001.001.13. */
  originalMessageNameId: string;
  originalCreationDateTime?: string;
  originalNumberOfTransactions?: number;
  originalControlSum?: number;
  groupStatus?: string;
  statusReasons?: StatusReasonInput[];
  transactionsPerStatus?: Array<{ detailedNumberOfTransactions: number; detailedStatus: string; detailedControlSum?: number }>;
  paymentInstructions?: Pain002PaymentInstructionStatusInput[];
}

export function buildPain002Xml(input: Pain002Input): BuiltIso20022Message {
  const schema = getMessageSchema('pain.002.001.15');
  if (!input?.originalMessageId) throw new Error('pain.002.001.15 requires originalMessageId (OrgnlGrpInfAndSts/OrgnlMsgId)');
  if (!input?.originalMessageNameId) throw new Error('pain.002.001.15 requires originalMessageNameId (OrgnlGrpInfAndSts/OrgnlMsgNmId)');

  const now = input.creationDateTime instanceof Date ? input.creationDateTime : new Date();
  const creationDateTime = isoDateTime(now);
  const messageId = input.messageId
    ? txt(input.messageId, 35, 'GrpHdr.MsgId')
    : escapeXml(`PS-STATUS-${now.getTime().toString(36).toUpperCase()}`);

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
      if (tx.originalTransactionReference?.instructedAmount) {
        const amount = Number(tx.originalTransactionReference.instructedAmount.amount);
        const ccy = normCurrency(tx.originalTransactionReference.instructedAmount.currency, `${at}.transactions[${txIndex}].originalTransactionReference.instructedAmount.currency`);
        controlSum += amount;
        if (controlCurrency === null) controlCurrency = ccy;
        else if (controlCurrency !== ccy) mixedCurrency = true;
      }
      return buildTransactionStatus(tx, `${at}.transactions[${txIndex}]`);
    }).join('\n');

    return (
      `    <OrgnlPmtInfAndSts>\n` +
      `${element('OrgnlPmtInfId', txt(instruction.originalPaymentInfoId, 35, `${at}.originalPaymentInfoId`), '      ')}\n` +
      `${numericElement('OrgnlNbOfTxs', instruction.originalNumberOfTransactions, '      ')}` +
      `${numericElement('OrgnlCtrlSum', instruction.originalControlSum, '      ')}` +
      `${element('PmtInfSts', normaliseStatus(instruction.paymentInfoStatus, `${at}.paymentInfoStatus`), '      ')}${instruction.paymentInfoStatus ? '\n' : ''}` +
      `${statusReasonXml(instruction.statusReasons, '      ')}` +
      `${transactionsPerStatusXml(instruction.transactionsPerStatus, '      ')}` +
      `${txXml}${txXml ? '\n' : ''}` +
      `    </OrgnlPmtInfAndSts>`
    );
  }).join('\n');

  const groupControlSum = input.originalControlSum !== undefined
    ? decimal(Number(input.originalControlSum), 5, 'OrgnlGrpInfAndSts.OrgnlCtrlSum')
    : null;

  const xml =
    `${XML_DECLARATION}\n` +
    `<Document xmlns="${schema.namespace}">\n` +
    `  <CstmrPmtStsRpt>\n` +
    `    <GrpHdr>\n` +
    `${element('MsgId', messageId, '      ')}\n` +
    `${element('CreDtTm', creationDateTime, '      ')}\n` +
    `${input.initiatingParty ? `${partyXml('InitgPty', input.initiatingParty, '      ')}\n` : ''}` +
    `    </GrpHdr>\n` +
    `    <OrgnlGrpInfAndSts>\n` +
    `${element('OrgnlMsgId', txt(input.originalMessageId, 35, 'OrgnlGrpInfAndSts.OrgnlMsgId'), '      ')}\n` +
    `${element('OrgnlMsgNmId', txt(input.originalMessageNameId, 35, 'OrgnlGrpInfAndSts.OrgnlMsgNmId'), '      ')}\n` +
    `${element('OrgnlCreDtTm', input.originalCreationDateTime ? isoDateTime(new Date(input.originalCreationDateTime)) : '', '      ')}${input.originalCreationDateTime ? '\n' : ''}` +
    `${numericElement('OrgnlNbOfTxs', input.originalNumberOfTransactions, '      ')}` +
    `${groupControlSum === null ? '' : `${element('OrgnlCtrlSum', groupControlSum, '      ')}\n`}` +
    `${element('GrpSts', normaliseStatus(input.groupStatus, 'OrgnlGrpInfAndSts.GrpSts'), '      ')}${input.groupStatus ? '\n' : ''}` +
    `${statusReasonXml(input.statusReasons, '      ')}` +
    `${transactionsPerStatusXml(input.transactionsPerStatus, '      ')}` +
    `    </OrgnlGrpInfAndSts>\n` +
    `${instructionXml}${instructionXml ? '\n' : ''}` +
    `  </CstmrPmtStsRpt>\n` +
    `</Document>\n`;

  return {
    messageType: 'pain.002.001.15',
    messageName: schema.messageName,
    messageId,
    creationDateTime,
    numberOfTransactions: transactionCount,
    controlSum: mixedCurrency || controlCurrency === null ? null : Number(controlSum.toFixed(5)),
    currency: mixedCurrency ? null : controlCurrency,
    initiatingParty: input.initiatingParty?.name ? String(input.initiatingParty.name) : null,
    xml,
  };
}

function buildTransactionStatus(tx: Pain002TransactionStatusInput, at: string): string {
  if (!tx || typeof tx !== 'object') throw new Error(`${at} is not an object`);
  const status = normaliseStatus(tx.transactionStatus, `${at}.transactionStatus`);
  const uetr = tx.originalUetr ? uuidV4(tx.originalUetr, `${at}.originalUetr`) : '';

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
    if (parts.length) referenceXml = `      <OrgnlTxRef>\n${parts.join('\n')}\n      </OrgnlTxRef>\n`;
  }

  const statusReasons = statusReasonXml(tx.statusReasons, '        ');

  return (
    `      <TxInfAndSts>\n` +
    `${element('StsId', tx.statusId ? txt(tx.statusId, 35, `${at}.statusId`) : '', '        ')}${tx.statusId ? '\n' : ''}` +
    `${element('OrgnlInstrId', tx.originalInstructionId ? txt(tx.originalInstructionId, 35, `${at}.originalInstructionId`) : '', '        ')}${tx.originalInstructionId ? '\n' : ''}` +
    `${element('OrgnlEndToEndId', tx.originalEndToEndId ? txt(tx.originalEndToEndId, 35, `${at}.originalEndToEndId`) : '', '        ')}${tx.originalEndToEndId ? '\n' : ''}` +
    `${element('OrgnlUETR', uetr, '        ')}${uetr ? '\n' : ''}` +
    `${element('TxSts', status || '', '        ')}${status ? '\n' : ''}` +
    `${statusReasons}` +
    `${element('AccptncDtTm', tx.acceptedDateTime ? isoDateTime(new Date(tx.acceptedDateTime)) : '', '        ')}${tx.acceptedDateTime ? '\n' : ''}` +
    `${element('AcctSvcrRef', tx.accountServicerReference ? txt(tx.accountServicerReference, 35, `${at}.accountServicerReference`) : '', '        ')}${tx.accountServicerReference ? '\n' : ''}` +
    `${element('ClrSysRef', tx.clearingSystemReference ? txt(tx.clearingSystemReference, 35, `${at}.clearingSystemReference`) : '', '        ')}${tx.clearingSystemReference ? '\n' : ''}` +
    `${referenceXml}` +
    `      </TxInfAndSts>`
  );
}

function statusReasonXml(reasons: StatusReasonInput[] | undefined, indent: string): string {
  if (!Array.isArray(reasons) || !reasons.length) return '';
  return reasons.map((reason, index) => {
    if (!reason || (!reason.code && !reason.proprietary)) {
      throw new Error(`statusReasons[${index}] requires code or proprietary`);
    }
    const rsn = reason.code
      ? `<Cd>${txt(reason.code, 4, `statusReasons[${index}].code`)}</Cd>`
      : `<Prtry>${txt(reason.proprietary, 35, `statusReasons[${index}].proprietary`)}</Prtry>`;
    const additional = (reason.additionalInformation || [])
      .filter(Boolean)
      .map(line => element('AddtlInf', txt(line, 105, `statusReasons[${index}].additionalInformation`), indent + '    '))
      .join('\n');
    return (
      `${indent}<StsRsnInf>\n` +
      `${reason.originator ? `${partyXml('Orgtr', reason.originator, indent + '  ')}\n` : ''}` +
      `${indent}  <Rsn>${rsn}</Rsn>\n` +
      (additional ? `${additional}\n` : '') +
      `${indent}</StsRsnInf>`
    );
  }).join('\n') + '\n';
}

function transactionsPerStatusXml(entries: Array<{ detailedNumberOfTransactions: number; detailedStatus: string; detailedControlSum?: number }> | undefined, indent: string): string {
  if (!Array.isArray(entries) || !entries.length) return '';
  return entries.map((entry, index) => {
    const status = normaliseStatus(entry.detailedStatus, `transactionsPerStatus[${index}].detailedStatus`);
    if (!status) throw new Error(`transactionsPerStatus[${index}].detailedStatus is required`);
    return (
      `${indent}<NbOfTxsPerSts>\n` +
      `${element('DtldNbOfTxs', count(entry.detailedNumberOfTransactions, 'DtldNbOfTxs'), indent + '  ')}\n` +
      `${element('DtldSts', status, indent + '  ')}\n` +
      `${entry.detailedControlSum === undefined ? '' : `${element('DtldCtrlSum', decimal(Number(entry.detailedControlSum), 5, 'DtldCtrlSum'), indent + '  ')}\n`}` +
      `${indent}</NbOfTxsPerSts>`
    );
  }).join('\n') + '\n';
}

function numericElement(tag: string, value: number | undefined, indent: string): string {
  if (value === undefined || value === null) return '';
  return `${element(tag, count(Number(value), tag), indent)}\n`;
}

function normaliseStatus(value: unknown, field: string): string {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  const code = String(value).trim().toUpperCase();
  if (!STATUS_CODES.test(code)) {
    throw new Error(`${field} must be a 1-4 character external status code (received "${value}")`);
  }
  return escapeXml(code);
}
