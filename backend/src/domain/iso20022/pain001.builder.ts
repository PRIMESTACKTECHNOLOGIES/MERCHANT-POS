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
  oneOf,
  optionalOneOf,
  partyXml,
  remittanceXml,
  txt,
  uuidV4,
} from './xml.util';
import { BuiltIso20022Message, getMessageSchema } from './messageSchemas';

/**
 * pain.001.001.13 — CustomerCreditTransferInitiationV13
 *
 * Document / CstmrCdtTrfInitn
 *   GrpHdr   GroupHeader114     MsgId, CreDtTm, Authstn*, NbOfTxs, CtrlSum?, InitgPty, FwdgAgt?, InitnSrc?
 *   PmtInf*  PaymentInstruction51
 *   SplmtryData*
 */

const PAYMENT_METHODS = ['CHK', 'TRF', 'TRA'] as const;
const CHARGE_BEARERS = ['DEBT', 'CRED', 'SHAR', 'SLEV'] as const;
const PRIORITIES = ['HIGH', 'NORM'] as const;

export interface Pain001TransactionInput {
  /** PaymentIdentification6/InstrId (Max35Text) */
  instructionId?: string;
  /** PaymentIdentification6/EndToEndId (Max35Text) — mandatory */
  endToEndId: string;
  /** PaymentIdentification6/UETR (UUIDv4Identifier) */
  uetr?: string;
  amount: number;
  currency: string;
  creditor: IsoAccountParty;
  /** Creditor agent — required unless the payment instruction supplies a default. */
  creditorAgent?: IsoAccountParty;
  chargeBearer?: string;
  priority?: string;
  /** PaymentTypeInformation26/SvcLvl/Cd (external code, e.g. SEPA/NURG/G001) */
  serviceLevelCode?: string;
  /** PaymentTypeInformation26/LclInstrm/Cd */
  localInstrumentCode?: string;
  /** PaymentTypeInformation26/CtgyPurp/Cd */
  categoryPurposeCode?: string;
  /** Purpose2Choice/Cd */
  purposeCode?: string;
  remittance?: IsoRemittance;
  /** ExchangeRate1 / XchgRate (BaseOneRate) with optional unit currency */
  exchangeRate?: { unitCurrency?: string; rate: number; contractId?: string };
  /** InstrForCdtrAgt/Cd + InstrForCdtrAgt/InstrInf */
  instructionForCreditorAgent?: { code?: string; information?: string };
}

export interface Pain001PaymentInstructionInput {
  /** PmtInfId (Max35Text) */
  paymentInfoId?: string;
  /** ReqdExctnDt as ISODate (DateAndDateTime2Choice/Dt) */
  requestedExecutionDate?: string;
  paymentMethod?: string;
  batchBooking?: boolean;
  priority?: string;
  chargeBearer?: string;
  serviceLevelCode?: string;
  localInstrumentCode?: string;
  categoryPurposeCode?: string;
  /** Dbtr — required here or at the document level. */
  debtor?: IsoAccountParty;
  transactions: Pain001TransactionInput[];
}

export interface Pain001Input {
  /** GrpHdr/MsgId (Max35Text) — generated when omitted. */
  messageId?: string;
  creationDateTime?: Date;
  /** GrpHdr/InitgPty */
  initiatingParty: IsoAccountParty;
  /** Default Dbtr applied to every payment instruction that omits one. */
  debtor?: IsoAccountParty;
  paymentInstructions: Pain001PaymentInstructionInput[];
}

export function buildPain001Xml(input: Pain001Input): BuiltIso20022Message {
  const schema = getMessageSchema('pain.001.001.13');
  const instructions = Array.isArray(input?.paymentInstructions) ? input.paymentInstructions : [];
  if (!instructions.length) throw new Error('pain.001.001.13 requires at least one payment instruction');

  const now = input.creationDateTime instanceof Date ? input.creationDateTime : new Date();
  const creationDateTime = isoDateTime(now);
  const messageId = input.messageId
    ? txt(input.messageId, 35, 'GrpHdr.MsgId')
    : escapeXml(`PS-${now.getTime().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);

  let totalTransactions = 0;
  let totalControlSum = 0;
  const currencies = new Set<string>();

  const paymentInfoXml = instructions.map((instruction, index) => {
    if (!instruction || typeof instruction !== 'object') {
      throw new Error(`paymentInstructions[${index}] is not an object`);
    }
    const transactions = Array.isArray(instruction.transactions) ? instruction.transactions : [];
    if (!transactions.length) throw new Error(`paymentInstructions[${index}].transactions must not be empty`);

    const debtor = instruction.debtor || input.debtor;
    if (!debtor) throw new Error(`paymentInstructions[${index}] requires a debtor (instruction-level or document-level)`);

    const paymentMethod = oneOf(instruction.paymentMethod ?? 'TRF', PAYMENT_METHODS, `paymentInstructions[${index}].paymentMethod`);
    const paymentInfoId = instruction.paymentInfoId
      ? txt(instruction.paymentInfoId, 35, `paymentInstructions[${index}].paymentInfoId`)
      : escapeXml(`PMTINF-${String(index + 1).padStart(2, '0')}-${messageId}`.slice(0, 35));
    const executionDate = isoDate(instruction.requestedExecutionDate || now, `paymentInstructions[${index}].requestedExecutionDate`);

    // The amount control sum is only meaningful when the instruction is single-currency.
    const instructionCurrencies = new Set<string>();
    let instructionSum = 0;
    transactions.forEach((tx, txIndex) => {
      const ccy = normCurrency(tx.currency, `paymentInstructions[${index}].transactions[${txIndex}].currency`);
      instructionCurrencies.add(ccy);
      currencies.add(ccy);
      instructionSum += Number(tx.amount);
    });
    if (instructionCurrencies.size !== 1) {
      throw new Error(`paymentInstructions[${index}] mixes currencies (${[...instructionCurrencies].join(', ')}); split it into one instruction per currency`);
    }
    if (!Number.isFinite(instructionSum) || instructionSum < 0) {
      throw new Error(`paymentInstructions[${index}] has an invalid control sum`);
    }

    const txXml = transactions.map((tx, txIndex) => buildCreditTransferTransaction(tx, txIndex, `paymentInstructions[${index}].transactions`, {
      chargeBearer: instruction.chargeBearer,
      priority: instruction.priority,
      serviceLevelCode: instruction.serviceLevelCode,
      localInstrumentCode: instruction.localInstrumentCode,
      categoryPurposeCode: instruction.categoryPurposeCode,
    })).join('\n');

    totalTransactions += transactions.length;
    totalControlSum += instructionSum;

    const batchBooking = instruction.batchBooking === undefined ? '' : element('BtchBookg', instruction.batchBooking ? 'true' : 'false', '      ');
    const chargeBearer = optionalOneOf(instruction.chargeBearer, CHARGE_BEARERS, `paymentInstructions[${index}].chargeBearer`);
    const pmtTpInf = buildPaymentTypeInformation(
      {
        priority: instruction.priority,
        serviceLevelCode: instruction.serviceLevelCode,
        localInstrumentCode: instruction.localInstrumentCode,
        categoryPurposeCode: instruction.categoryPurposeCode,
      },
      '      '
    );

    return (
      `    <PmtInf>\n` +
      `${element('PmtInfId', paymentInfoId, '      ')}\n` +
      `${element('PmtMtd', paymentMethod, '      ')}\n` +
      `${batchBooking}${batchBooking ? '\n' : ''}` +
      `${element('NbOfTxs', count(transactions.length), '      ')}\n` +
      `${element('CtrlSum', decimal(instructionSum, 5, 'CtrlSum'), '      ')}\n` +
      `${pmtTpInf}` +
      `      <ReqdExctnDt>\n        <Dt>${executionDate}</Dt>\n      </ReqdExctnDt>\n` +
      `${partyXml('Dbtr', debtor, '      ')}\n` +
      `${accountXml('DbtrAcct', debtor, '      ')}\n` +
      `${agentXml('DbtrAgt', debtor, '      ')}\n` +
      `${element('ChrgBr', chargeBearer || '', '      ')}${chargeBearer ? '\n' : ''}` +
      `${txXml}\n` +
      `    </PmtInf>`
    );
  }).join('\n');

  const currencyList = [...currencies];
  const controlSum = currencyList.length === 1 ? Number(totalControlSum.toFixed(5)) : null;
  const namespace = schema.namespace;

  const xml =
    `${XML_DECLARATION}\n` +
    `<Document xmlns="${namespace}">\n` +
    `  <CstmrCdtTrfInitn>\n` +
    `    <GrpHdr>\n` +
    `${element('MsgId', messageId, '      ')}\n` +
    `${element('CreDtTm', creationDateTime, '      ')}\n` +
    `${element('NbOfTxs', count(totalTransactions), '      ')}\n` +
    `${controlSum === null ? '' : `${element('CtrlSum', decimal(controlSum, 5, 'CtrlSum'), '      ')}\n`}` +
    `${partyXml('InitgPty', input.initiatingParty, '      ')}\n` +
    `    </GrpHdr>\n` +
    `${paymentInfoXml}\n` +
    `  </CstmrCdtTrfInitn>\n` +
    `</Document>\n`;

  return {
    messageType: 'pain.001.001.13',
    messageName: schema.messageName,
    messageId,
    creationDateTime,
    numberOfTransactions: totalTransactions,
    controlSum,
    currency: currencyList.length === 1 ? currencyList[0] : null,
    initiatingParty: input.initiatingParty?.name ? String(input.initiatingParty.name) : null,
    xml,
  };
}

interface InstructionDefaults {
  chargeBearer?: string;
  priority?: string;
  serviceLevelCode?: string;
  localInstrumentCode?: string;
  categoryPurposeCode?: string;
}

function buildCreditTransferTransaction(
  tx: Pain001TransactionInput,
  txIndex: number,
  path: string,
  defaults: InstructionDefaults
): string {
  const at = `${path}[${txIndex}]`;
  if (!tx || typeof tx !== 'object') throw new Error(`${at} is not an object`);
  if (!tx.creditor) throw new Error(`${at}.creditor is required`);
  if (typeof tx.amount !== 'number' || !Number.isFinite(tx.amount) || tx.amount < 0) {
    throw new Error(`${at}.amount must be a non-negative number`);
  }

  const ccy = normCurrency(tx.currency, `${at}.currency`);
  const uetr = tx.uetr ? uuidV4(tx.uetr, `${at}.uetr`) : null;
  const instd = tx.instructionId ? element('InstrId', txt(tx.instructionId, 35, `${at}.instructionId`), '          ') : '';

  const chargeBearer = optionalOneOf(tx.chargeBearer ?? defaults.chargeBearer, CHARGE_BEARERS, `${at}.chargeBearer`);
  const pmtTpInf = buildPaymentTypeInformation(
    {
      priority: tx.priority ?? defaults.priority,
      serviceLevelCode: tx.serviceLevelCode ?? defaults.serviceLevelCode,
      localInstrumentCode: tx.localInstrumentCode ?? defaults.localInstrumentCode,
      categoryPurposeCode: tx.categoryPurposeCode ?? defaults.categoryPurposeCode,
    },
    '        '
  );

  const exchangeRate = tx.exchangeRate
    ? `        <XchgRateInf>\n` +
      `${element('UnitCcy', tx.exchangeRate.unitCurrency ? normCurrency(tx.exchangeRate.unitCurrency, `${at}.exchangeRate.unitCurrency`) : '', '          ')}\n` +
      `${element('XchgRate', decimal(tx.exchangeRate.rate, 10, `${at}.exchangeRate.rate`), '          ')}\n` +
      `${element('CtrctId', tx.exchangeRate.contractId ? txt(tx.exchangeRate.contractId, 35, `${at}.exchangeRate.contractId`) : '', '          ')}\n` +
      `        </XchgRateInf>\n`
    : '';

  const instructionForCreditorAgent = tx.instructionForCreditorAgent && (tx.instructionForCreditorAgent.code || tx.instructionForCreditorAgent.information)
    ? `        <InstrForCdtrAgt>\n` +
      `${element('Cd', tx.instructionForCreditorAgent.code ? txt(tx.instructionForCreditorAgent.code, 4, `${at}.instructionForCreditorAgent.code`) : '', '          ')}\n` +
      `${element('InstrInf', tx.instructionForCreditorAgent.information ? txt(tx.instructionForCreditorAgent.information, 140, `${at}.instructionForCreditorAgent.information`) : '', '          ')}\n` +
      `        </InstrForCdtrAgt>\n`
    : '';

  const remittance = remittanceXml(tx.remittance, '        ');

  return (
    `      <CdtTrfTxInf>\n` +
    `        <PmtId>\n` +
    `${instd}${instd ? '\n' : ''}` +
    `${element('EndToEndId', txt(tx.endToEndId, 35, `${at}.endToEndId`), '          ')}\n` +
    `${element('UETR', uetr || '', '          ')}${uetr ? '\n' : ''}` +
    `        </PmtId>\n` +
    `${pmtTpInf}` +
    `        <Amt>\n${ccyAmount('InstdAmt', ccy, tx.amount, `${at}.amount`)}\n        </Amt>\n` +
    `${exchangeRate}` +
    `${element('ChrgBr', chargeBearer || '', '        ')}${chargeBearer ? '\n' : ''}` +
    `${agentXml('CdtrAgt', tx.creditorAgent || tx.creditor, '        ')}\n` +
    `${partyXml('Cdtr', tx.creditor, '        ')}\n` +
    `${accountXml('CdtrAcct', tx.creditor, '        ')}\n` +
    `${instructionForCreditorAgent}` +
    `${element('Purp', tx.purposeCode ? `<Cd>${txt(tx.purposeCode, 4, `${at}.purposeCode`)}</Cd>` : '', '        ')}${tx.purposeCode ? '\n' : ''}` +
    `${remittance}${remittance ? '\n' : ''}` +
    `      </CdtTrfTxInf>`
  );
}

/** PaymentTypeInformation26 — order: InstrPrty, SvcLvl*, LclInstrm, CtgyPurp. */
function buildPaymentTypeInformation(tp: InstructionDefaults, indent: string): string {
  const priority = optionalOneOf(tp.priority, PRIORITIES, 'PmtTpInf.InstrPrty');
  const svcLvl = tp.serviceLevelCode
    ? `${element('SvcLvl', `<Cd>${txt(tp.serviceLevelCode, 4, 'PmtTpInf.SvcLvl.Cd')}</Cd>`, indent + '  ')}\n`
    : '';
  const lclInstrm = tp.localInstrumentCode
    ? `${element('LclInstrm', `<Cd>${txt(tp.localInstrumentCode, 35, 'PmtTpInf.LclInstrm.Cd')}</Cd>`, indent + '  ')}\n`
    : '';
  const ctgyPurp = tp.categoryPurposeCode
    ? `${element('CtgyPurp', `<Cd>${txt(tp.categoryPurposeCode, 4, 'PmtTpInf.CtgyPurp.Cd')}</Cd>`, indent + '  ')}\n`
    : '';
  if (!priority && !svcLvl && !lclInstrm && !ctgyPurp) return '';
  return (
    `${indent}<PmtTpInf>\n` +
    `${element('InstrPrty', priority || '', indent + '  ')}${priority ? '\n' : ''}` +
    `${svcLvl}${lclInstrm}${ctgyPurp}` +
    `${indent}</PmtTpInf>\n`
  );
}
