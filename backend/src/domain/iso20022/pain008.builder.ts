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
  optTxt,
  partyXml,
  remittanceXml,
  txt,
  uuidV4,
} from './xml.util';
import { BuiltIso20022Message, getMessageSchema } from './messageSchemas';

/**
 * pain.008.001.12 — CustomerDirectDebitInitiationV12
 *
 * Document / CstmrDrctDbtInitn
 *   GrpHdr   GroupHeader118  MsgId, CreDtTm, Authstn*, NbOfTxs, CtrlSum?, InitgPty, FwdgAgt?
 *   PmtInf*  PaymentInstruction50
 *   SplmtryData*
 */

const CHARGE_BEARERS = ['DEBT', 'CRED', 'SHAR', 'SLEV'] as const;
const PRIORITIES = ['HIGH', 'NORM'] as const;
const FREQUENCY_CODES = ['YEAR', 'MNTH', 'QURT', 'MIAN', 'WEEK', 'DAIL', 'ADHO', 'INDA', 'FRTN'] as const;
const SEQUENCE_TYPES = ['FRST', 'RCUR', 'FNAL', 'OOFF', 'RPRE'] as const;

export interface MandateInput {
  /** MandateRelatedInformation16/MndtId (Max35Text) */
  mandateId?: string;
  /** DtOfSgntr (ISODate) */
  dateOfSignature?: string;
  /** AmdmntInd (TrueFalseIndicator) */
  amendmentIndicator?: boolean;
  /** ElctrncSgntr (Max1025Text) */
  electronicSignature?: string;
  firstCollectionDate?: string;
  finalCollectionDate?: string;
  /** Frequency36Choice — `Tp` alone, or `Prd` when countPerPeriod is given. */
  frequency?: { type: string; countPerPeriod?: number; pointInTime?: string };
  /** MandateSetupReason1Choice */
  reasonCode?: string;
  reasonProprietary?: string;
  /** TrckgDays (Exact2NumericText) */
  trackingDays?: string;
}

export interface Pain008TransactionInput {
  instructionId?: string;
  endToEndId: string;
  uetr?: string;
  amount: number;
  currency: string;
  chargeBearer?: string;
  mandate: MandateInput;
  /** DrctDbtTx/CdtrSchmeId — creditor's scheme identification for this mandate. */
  mandateCreditorSchemeId?: string;
  ultimateCreditor?: IsoAccountParty;
  /** DbtrAgt — mandatory in pain.008. */
  debtorAgent: IsoAccountParty;
  debtor: IsoAccountParty;
  purposeCode?: string;
  remittance?: IsoRemittance;
}

export interface Pain008PaymentInstructionInput {
  paymentInfoId?: string;
  /** ReqdColltnDt (ISODate) — mandatory. */
  requestedCollectionDate: string;
  batchBooking?: boolean;
  priority?: string;
  serviceLevelCode?: string;
  localInstrumentCode?: string;
  /** PaymentTypeInformation29/SeqTp — FRST/RCUR/FNAL/OOFF/RPRE */
  sequenceType?: string;
  categoryPurposeCode?: string;
  /** Cdtr — mandatory. */
  creditor: IsoAccountParty;
  /** CdtrAgt — mandatory in pain.008 (PaymentInstruction50). */
  creditorAgent: IsoAccountParty;
  ultimateCreditor?: IsoAccountParty;
  chargeBearer?: string;
  /** CdtrSchmeId — creditor scheme identification at instruction level. */
  creditorSchemeId?: string;
  transactions: Pain008TransactionInput[];
}

export interface Pain008Input {
  messageId?: string;
  creationDateTime?: Date;
  initiatingParty: IsoAccountParty;
  paymentInstructions: Pain008PaymentInstructionInput[];
}

export function buildPain008Xml(input: Pain008Input): BuiltIso20022Message {
  const schema = getMessageSchema('pain.008.001.12');
  const instructions = Array.isArray(input?.paymentInstructions) ? input.paymentInstructions : [];
  if (!instructions.length) throw new Error('pain.008.001.12 requires at least one payment instruction');

  const now = input.creationDateTime instanceof Date ? input.creationDateTime : new Date();
  const creationDateTime = isoDateTime(now);
  const messageId = input.messageId
    ? txt(input.messageId, 35, 'GrpHdr.MsgId')
    : escapeXml(`PS-DD-${now.getTime().toString(36).toUpperCase()}`);

  let totalTransactions = 0;
  let totalControlSum = 0;
  const currencies = new Set<string>();

  const instructionXml = instructions.map((instruction, index) => {
    const at = `paymentInstructions[${index}]`;
    if (!instruction || typeof instruction !== 'object') throw new Error(`${at} is not an object`);
    if (!instruction.creditor) throw new Error(`${at}.creditor is required`);
    if (!instruction.creditorAgent) throw new Error(`${at}.creditorAgent is required (CdtrAgt is mandatory in pain.008)`);

    const transactions = Array.isArray(instruction.transactions) ? instruction.transactions : [];
    if (!transactions.length) throw new Error(`${at}.transactions must not be empty`);

    const collectionDate = isoDate(instruction.requestedCollectionDate, `${at}.requestedCollectionDate`);
    const paymentInfoId = instruction.paymentInfoId
      ? txt(instruction.paymentInfoId, 35, `${at}.paymentInfoId`)
      : escapeXml(`DD-${String(index + 1).padStart(2, '0')}-${messageId}`.slice(0, 35));

    const instructionCurrencies = new Set<string>();
    let instructionSum = 0;
    transactions.forEach((tx, txIndex) => {
      const ccy = normCurrency(tx.currency, `${at}.transactions[${txIndex}].currency`);
      instructionCurrencies.add(ccy);
      currencies.add(ccy);
      instructionSum += Number(tx.amount);
    });
    if (instructionCurrencies.size !== 1) {
      throw new Error(`${at} mixes currencies (${[...instructionCurrencies].join(', ')}); split it into one instruction per currency`);
    }
    if (!Number.isFinite(instructionSum) || instructionSum < 0) {
      throw new Error(`${at} has an invalid control sum`);
    }

    const txXml = transactions
      .map((tx, txIndex) => buildDirectDebitTransaction(tx, `${at}.transactions[${txIndex}]`))
      .join('\n');

    totalTransactions += transactions.length;
    totalControlSum += instructionSum;

    const batchBooking = instruction.batchBooking === undefined ? '' : `${element('BtchBookg', instruction.batchBooking ? 'true' : 'false', '      ')}\n`;
    const pmtTpInf = buildDirectDebitPaymentTypeInformation(instruction, at, '      ');
    const chargeBearer = optionalOneOf(instruction.chargeBearer, CHARGE_BEARERS, `${at}.chargeBearer`);
    const creditorSchemeId = instruction.creditorSchemeId
      ? creditorSchemeIdXml(instruction.creditorSchemeId, `${at}.creditorSchemeId`, '      ')
      : '';

    return (
      `    <PmtInf>\n` +
      `${element('PmtInfId', paymentInfoId, '      ')}\n` +
      `${element('PmtMtd', 'DD', '      ')}\n` +
      `${batchBooking}` +
      `${element('NbOfTxs', count(transactions.length), '      ')}\n` +
      `${element('CtrlSum', decimal(instructionSum, 5, 'CtrlSum'), '      ')}\n` +
      `${pmtTpInf}` +
      `${element('ReqdColltnDt', collectionDate, '      ')}\n` +
      `${partyXml('Cdtr', instruction.creditor, '      ')}\n` +
      `${accountXml('CdtrAcct', instruction.creditor, '      ')}\n` +
      `${agentXml('CdtrAgt', instruction.creditorAgent, '      ')}\n` +
      `${instruction.ultimateCreditor ? `${partyXml('UltmtCdtr', instruction.ultimateCreditor, '      ')}\n` : ''}` +
      `${element('ChrgBr', chargeBearer || '', '      ')}${chargeBearer ? '\n' : ''}` +
      `${creditorSchemeId}` +
      `${txXml}\n` +
      `    </PmtInf>`
    );
  }).join('\n');

  const currencyList = [...currencies];
  const controlSum = currencyList.length === 1 ? Number(totalControlSum.toFixed(5)) : null;

  const xml =
    `${XML_DECLARATION}\n` +
    `<Document xmlns="${schema.namespace}">\n` +
    `  <CstmrDrctDbtInitn>\n` +
    `    <GrpHdr>\n` +
    `${element('MsgId', messageId, '      ')}\n` +
    `${element('CreDtTm', creationDateTime, '      ')}\n` +
    `${element('NbOfTxs', count(totalTransactions), '      ')}\n` +
    `${controlSum === null ? '' : `${element('CtrlSum', decimal(controlSum, 5, 'CtrlSum'), '      ')}\n`}` +
    `${partyXml('InitgPty', input.initiatingParty, '      ')}\n` +
    `    </GrpHdr>\n` +
    `${instructionXml}\n` +
    `  </CstmrDrctDbtInitn>\n` +
    `</Document>\n`;

  return {
    messageType: 'pain.008.001.12',
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

function buildDirectDebitTransaction(tx: Pain008TransactionInput, at: string): string {
  if (!tx || typeof tx !== 'object') throw new Error(`${at} is not an object`);
  if (!tx.debtor) throw new Error(`${at}.debtor is required`);
  if (!tx.debtorAgent) throw new Error(`${at}.debtorAgent is required (DbtrAgt is mandatory in pain.008)`);
  if (!tx.mandate) throw new Error(`${at}.mandate is required (DrctDbtTx/MndtRltdInf)`);

  const ccy = normCurrency(tx.currency, `${at}.currency`);
  const chargeBearer = optionalOneOf(tx.chargeBearer, CHARGE_BEARERS, `${at}.chargeBearer`);
  const uetr = tx.uetr ? uuidV4(tx.uetr, `${at}.uetr`) : '';

  const mandate = buildMandate(tx.mandate, `${at}.mandate`, '          ');
  const mandateCreditorScheme = tx.mandateCreditorSchemeId
    ? creditorSchemeIdXml(tx.mandateCreditorSchemeId, `${at}.mandateCreditorSchemeId`, '          ')
    : '';
  const drctDbtTx =
    `        <DrctDbtTx>\n` +
    `${mandate}` +
    `${mandateCreditorScheme}` +
    `        </DrctDbtTx>\n`;

  const remittance = remittanceXml(tx.remittance, '        ');

  return (
    `      <DrctDbtTxInf>\n` +
    `        <PmtId>\n` +
    `${element('InstrId', tx.instructionId ? txt(tx.instructionId, 35, `${at}.instructionId`) : '', '          ')}${tx.instructionId ? '\n' : ''}` +
    `${element('EndToEndId', txt(tx.endToEndId, 35, `${at}.endToEndId`), '          ')}\n` +
    `${element('UETR', uetr, '          ')}${uetr ? '\n' : ''}` +
    `        </PmtId>\n` +
    `        ${ccyAmount('InstdAmt', ccy, tx.amount, `${at}.amount`)}\n` +
    `${element('ChrgBr', chargeBearer || '', '        ')}${chargeBearer ? '\n' : ''}` +
    `${drctDbtTx}` +
    `${tx.ultimateCreditor ? `${partyXml('UltmtCdtr', tx.ultimateCreditor, '        ')}\n` : ''}` +
    `${agentXml('DbtrAgt', tx.debtorAgent, '        ')}\n` +
    `${partyXml('Dbtr', tx.debtor, '        ')}\n` +
    `${accountXml('DbtrAcct', tx.debtor, '        ')}\n` +
    `${element('Purp', tx.purposeCode ? `<Cd>${txt(tx.purposeCode, 4, `${at}.purposeCode`)}</Cd>` : '', '        ')}${tx.purposeCode ? '\n' : ''}` +
    `${remittance}${remittance ? '\n' : ''}` +
    `      </DrctDbtTxInf>`
  );
}

/** MandateRelatedInformation16 — order: MndtId, DtOfSgntr, AmdmntInd, AmdmntInfDtls, ElctrncSgntr, FrstColltnDt, FnlColltnDt, Frqcy, Rsn, TrckgDays. */
function buildMandate(mandate: MandateInput, at: string, indent: string): string {
  const mndtId = element('MndtId', mandate.mandateId ? txt(mandate.mandateId, 35, `${at}.mandateId`) : '', indent + '  ');
  const dtOfSgntr = element('DtOfSgntr', mandate.dateOfSignature ? isoDate(mandate.dateOfSignature, `${at}.dateOfSignature`) : '', indent + '  ');
  const amdmntInd = mandate.amendmentIndicator === undefined
    ? ''
    : element('AmdmntInd', mandate.amendmentIndicator ? 'true' : 'false', indent + '  ');
  const elctrncSgntr = element('ElctrncSgntr', mandate.electronicSignature ? txt(mandate.electronicSignature, 1025, `${at}.electronicSignature`) : '', indent + '  ');
  const frstColltnDt = element('FrstColltnDt', mandate.firstCollectionDate ? isoDate(mandate.firstCollectionDate, `${at}.firstCollectionDate`) : '', indent + '  ');
  const fnlColltnDt = element('FnlColltnDt', mandate.finalCollectionDate ? isoDate(mandate.finalCollectionDate, `${at}.finalCollectionDate`) : '', indent + '  ');

  let frqcy = '';
  if (mandate.frequency) {
    const type = oneOf(mandate.frequency.type, FREQUENCY_CODES, `${at}.frequency.type`);
    if (mandate.frequency.pointInTime) {
      const pit = String(mandate.frequency.pointInTime).trim();
      if (!/^[0-9]{2}$/.test(pit)) throw new Error(`${at}.frequency.pointInTime must be 2 digits (Exact2NumericText)`);
      frqcy = `${indent}  <Frqcy>\n${indent}    <PtInTm>\n${element('Tp', type, indent + '      ')}\n${element('PtInTm', pit, indent + '      ')}\n${indent}    </PtInTm>\n${indent}  </Frqcy>`;
    } else if (mandate.frequency.countPerPeriod !== undefined) {
      frqcy =
        `${indent}  <Frqcy>\n${indent}    <Prd>\n` +
        `${element('Tp', type, indent + '      ')}\n` +
        `${element('CntPerPrd', decimal(Number(mandate.frequency.countPerPeriod), 5, `${at}.frequency.countPerPeriod`), indent + '      ')}\n` +
        `${indent}    </Prd>\n${indent}  </Frqcy>`;
    } else {
      frqcy = `${indent}  <Frqcy>\n${indent}    <Tp>${type}</Tp>\n${indent}  </Frqcy>`;
    }
  }

  let rsn = '';
  if (mandate.reasonCode) rsn = `${indent}  <Rsn><Cd>${txt(mandate.reasonCode, 4, `${at}.reasonCode`)}</Cd></Rsn>`;
  else if (mandate.reasonProprietary) rsn = `${indent}  <Rsn><Prtry>${txt(mandate.reasonProprietary, 70, `${at}.reasonProprietary`)}</Prtry></Rsn>`;

  let trckgDays = '';
  if (mandate.trackingDays) {
    const days = String(mandate.trackingDays).trim();
    if (!/^[0-9]{2}$/.test(days)) throw new Error(`${at}.trackingDays must be 2 digits (Exact2NumericText)`);
    trckgDays = element('TrckgDays', days, indent + '  ');
  }

  const body = [mndtId, dtOfSgntr, amdmntInd, elctrncSgntr, frstColltnDt, fnlColltnDt, frqcy, rsn, trckgDays]
    .filter(Boolean)
    .join('\n');

  return (
    `${indent}<MndtRltdInf>\n` +
    `${body}\n` +
    `${indent}</MndtRltdInf>\n`
  );
}

/** PaymentTypeInformation29 — order: InstrPrty, SvcLvl*, LclInstrm, SeqTp, CtgyPurp. */
function buildDirectDebitPaymentTypeInformation(instruction: Pain008PaymentInstructionInput, at: string, indent: string): string {
  const priority = optionalOneOf(instruction.priority, PRIORITIES, `${at}.priority`);
  const sequenceType = optionalOneOf(instruction.sequenceType, SEQUENCE_TYPES, `${at}.sequenceType`);
  const svcLvl = instruction.serviceLevelCode
    ? `${element('SvcLvl', `<Cd>${txt(instruction.serviceLevelCode, 4, `${at}.serviceLevelCode`)}</Cd>`, indent + '  ')}\n`
    : '';
  const lclInstrm = instruction.localInstrumentCode
    ? `${element('LclInstrm', `<Cd>${txt(instruction.localInstrumentCode, 35, `${at}.localInstrumentCode`)}</Cd>`, indent + '  ')}\n`
    : '';
  const ctgyPurp = instruction.categoryPurposeCode
    ? `${element('CtgyPurp', `<Cd>${txt(instruction.categoryPurposeCode, 4, `${at}.categoryPurposeCode`)}</Cd>`, indent + '  ')}\n`
    : '';
  if (!priority && !svcLvl && !lclInstrm && !sequenceType && !ctgyPurp) return '';
  return (
    `${indent}<PmtTpInf>\n` +
    `${element('InstrPrty', priority || '', indent + '  ')}${priority ? '\n' : ''}` +
    `${svcLvl}${lclInstrm}` +
    `${element('SeqTp', sequenceType || '', indent + '  ')}${sequenceType ? '\n' : ''}` +
    `${ctgyPurp}` +
    `${indent}</PmtTpInf>\n`
  );
}

/** CdtrSchmeId — PartyIdentification272/Id/PrvtId/Othr/Id. */
function creditorSchemeIdXml(value: string, field: string, indent: string): string {
  const id = optTxt(value, 256, field);
  if (!id) return '';
  return (
    `${indent}<CdtrSchmeId>\n` +
    `${indent}  <Id>\n` +
    `${indent}    <PrvtId>\n` +
    `${indent}      <Othr>\n` +
    `${indent}        <Id>${id}</Id>\n` +
    `${indent}      </Othr>\n` +
    `${indent}    </PrvtId>\n` +
    `${indent}  </Id>\n` +
    `${indent}</CdtrSchmeId>\n`
  );
}
