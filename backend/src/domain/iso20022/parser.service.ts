import { XMLParser } from 'fast-xml-parser';
import { IsoAccountParty, IsoRemittance } from './xml.util';
import { Iso20022MessageType, detectMessageType, getMessageSchema } from './messageSchemas';

/**
 * Inbound ISO 20022 parsing.
 *
 * The document is parsed once with `fast-xml-parser` into a plain object tree and
 * then read through the small helpers below. Two deliberate choices:
 *
 *   - `parseTagValue:false` keeps every leaf as a string, so an amount such as
 *     `1234567890123.45` never passes through a lossy JS number conversion
 *     before the caller decides what to do with it.
 *   - every `maxOccurs > 1` element is forced to an array, so the traversal never
 *     has to branch on "single item vs list".
 *
 * The parser is intentionally tolerant: it reports what the document actually
 * contains and records discrepancies in `warnings` instead of throwing. Schema
 * conformance is the job of `xsdValidator.service.ts`.
 */

const REPEATED_ELEMENTS = new Set([
  'PmtInf',
  'CdtTrfTxInf',
  'DrctDbtTxInf',
  'TxInf',
  'TxInfAndSts',
  'OrgnlPmtInfAndSts',
  'OrgnlPmtInfAndRvsl',
  'StsRsnInf',
  'RvslRsnInf',
  'NbOfTxsPerSts',
  'SvcLvl',
  'Ustrd',
  'Strd',
  'AddtlRmtInf',
  'AddtlInf',
  'AdrLine',
]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  allowBooleanAttributes: true,
  isArray: (tagName: string) => REPEATED_ELEMENTS.has(tagName),
});

export interface ParsedStatusReason {
  code?: string;
  proprietary?: string;
  additionalInformation?: string[];
}

export interface ParsedIso20022Transaction {
  instructionId: string | null;
  endToEndId: string | null;
  uetr: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  statusReasons: ParsedStatusReason[];
  /** pain.008 mandate identifier. */
  mandateId: string | null;
  /** pain.008 mandate signature date. */
  dateOfSignature: string | null;
  debtor: IsoAccountParty | null;
  creditor: IsoAccountParty | null;
  remittance: IsoRemittance | null;
}

export interface ParsedIso20022PaymentInstruction {
  paymentInfoId: string | null;
  /** pain.002 OriginalPaymentInstruction56 / pain.007 OriginalPaymentInstruction53 */
  originalPaymentInfoId: string | null;
  /** pain.007 RvslPmtInfId */
  reversalPaymentInfoId: string | null;
  paymentMethod: string | null;
  numberOfTransactions: number | null;
  controlSum: number | null;
  /** pain.001 ReqdExctnDt/Dt */
  requestedExecutionDate: string | null;
  /** pain.008 ReqdColltnDt */
  requestedCollectionDate: string | null;
  batchBooking: boolean | null;
  paymentInfoStatus: string | null;
  paymentInfoReversal: boolean | null;
  priority: string | null;
  serviceLevel: string | null;
  localInstrument: string | null;
  sequenceType: string | null;
  categoryPurpose: string | null;
  chargeBearer: string | null;
  debtor: IsoAccountParty | null;
  creditor: IsoAccountParty | null;
  statusReasons: ParsedStatusReason[];
  transactionsPerStatus: Array<{ number: number; status: string; controlSum: number | null }>;
  transactions: ParsedIso20022Transaction[];
}

export interface ParsedIso20022Document {
  messageType: Iso20022MessageType;
  messageName: string;
  namespace: string;
  rootElement: string;
  /** GrpHdr/MsgId */
  messageId: string | null;
  /** GrpHdr/CreDtTm */
  creationDateTime: string | null;
  numberOfTransactions: number | null;
  controlSum: number | null;
  initiatingParty: string | null;
  /** pain.002 OrgnlGrpInfAndSts / pain.007 OrgnlGrpInf */
  originalMessageId: string | null;
  originalMessageNameId: string | null;
  originalCreationDateTime: string | null;
  originalNumberOfTransactions: number | null;
  originalControlSum: number | null;
  /** pain.002 GrpSts */
  groupStatus: string | null;
  /** pain.007 GrpRvsl */
  groupReversal: boolean | null;
  groupStatusReasons: ParsedStatusReason[];
  paymentInstructions: ParsedIso20022PaymentInstruction[];
  warnings: string[];
}

// ── Low level traversal helpers ──────────────────────────────────────────────

type Obj = Record<string, any>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Reads the character data of a node, including attribute-bearing simple content. */
function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isObj(value) && value['#text'] !== undefined && value['#text'] !== null) return String(value['#text']);
  return undefined;
}

function attr(value: unknown, name: string): string | undefined {
  if (!isObj(value)) return undefined;
  const found = value[`@_${name}`];
  return found === undefined || found === null ? undefined : String(found);
}

function readRaw(value: unknown): string | undefined {
  const t = text(value);
  if (t === undefined) return undefined;
  const trimmed = t.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readNumber(value: unknown, field: string, warnings: string[]): number | null {
  const raw = readRaw(value);
  if (raw === undefined) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    warnings.push(`${field} is not numeric ("${raw}")`);
    return null;
  }
  return parsed;
}

function readBoolean(value: unknown): boolean | null {
  const raw = readRaw(value);
  if (raw === undefined) return null;
  const lowered = raw.toLowerCase();
  if (lowered === 'true' || lowered === '1') return true;
  if (lowered === 'false' || lowered === '0') return false;
  return null;
}

function readAmount(value: unknown): { amount: number; currency: string | null } | null {
  if (value === undefined || value === null) return null;
  const raw = readRaw(value);
  if (raw === undefined) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return null;
  const ccy = attr(value, 'Ccy');
  return { amount, currency: ccy ? ccy.toUpperCase() : null };
}

// ── Party / account / agent / remittance readers ─────────────────────────────

/** PartyIdentification272 → name, postal address, country of residence. */
function readParty(node: unknown): Partial<IsoAccountParty> | null {
  if (!isObj(node)) return null;
  const out: Partial<IsoAccountParty> = {};

  const name = readRaw(node.Nm);
  if (name) out.name = name;

  const address = node.PstlAdr;
  if (isObj(address)) {
    const country = readRaw(address.Ctry);
    if (country) out.country = country;
    const town = readRaw(address.TwnNm);
    if (town) out.townName = town;
    const lines = asArray(address.AdrLine).map(readRaw).filter(isString);
    if (lines.length) out.addressLines = lines;
  }

  const residence = readRaw(node.CtryOfRes);
  if (residence) out.countryOfResidence = residence;

  return Object.keys(out).length ? out : null;
}

/** CashAccount40 → IBAN or generic account identification. */
function readAccount(node: unknown): Partial<IsoAccountParty> | null {
  if (!isObj(node)) return null;
  const out: Partial<IsoAccountParty> = {};

  const id = node.Id;
  if (isObj(id)) {
    const iban = readRaw(id.IBAN);
    if (iban) out.iban = iban;
    const other = id.Othr;
    if (isObj(other)) {
      const otherId = readRaw(other.Id);
      if (otherId) out.otherAccountId = otherId;
      const scheme = other.SchmeNm;
      if (isObj(scheme)) {
        const proprietary = readRaw(scheme.Prtry);
        if (proprietary) out.otherAccountScheme = proprietary;
      }
    }
  }

  const accountCurrency = readRaw(node.Ccy);
  if (accountCurrency) out.accountCurrency = accountCurrency.toUpperCase();
  const accountName = readRaw(node.Nm);
  if (accountName) out.accountName = accountName;

  return Object.keys(out).length ? out : null;
}

/** BranchAndFinancialInstitutionIdentification8 → BIC / clearing member / LEI. */
function readAgent(node: unknown): Partial<IsoAccountParty> | null {
  if (!isObj(node)) return null;
  const institution = node.FinInstnId;
  if (!isObj(institution)) return null;
  const out: Partial<IsoAccountParty> = {};

  const bic = readRaw(institution.BICFI);
  if (bic) out.bic = bic;
  const lei = readRaw(institution.LEI);
  if (lei) out.lei = lei;
  const name = readRaw(institution.Nm);
  if (name) out.agentName = name;

  const member = institution.ClrSysMmbId;
  if (isObj(member)) {
    const memberId = readRaw(member.MmbId);
    if (memberId) out.clearingMemberId = memberId;
    const systemId = member.ClrSysId;
    if (isObj(systemId)) {
      const code = readRaw(systemId.Cd);
      if (code) out.clearingSystemCode = code;
    }
  }

  return Object.keys(out).length ? out : null;
}

/** Merges party + account + agent views of the same actor into one IsoAccountParty. */
function mergeParty(...parts: Array<Partial<IsoAccountParty> | null | undefined>): IsoAccountParty | null {
  const out: IsoAccountParty = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [key, value] of Object.entries(part)) {
      if (value === undefined || value === null || value === '') continue;
      (out as any)[key] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** RemittanceInformation26 → Ustrd* / Strd*. */
function readRemittance(node: unknown): IsoRemittance | null {
  if (!isObj(node)) return null;
  const out: IsoRemittance = {};

  const unstructured = asArray(node.Ustrd).map(readRaw).filter(isString);
  if (unstructured.length) out.unstructured = unstructured;

  const structured = asArray(node.Strd)[0];
  if (isObj(structured)) {
    const details: NonNullable<IsoRemittance['structured']> = {};
    const creditorReferenceInformation = structured.CdtrRefInf;
    if (isObj(creditorReferenceInformation)) {
      const type = creditorReferenceInformation.Tp;
      if (isObj(type)) {
        const codeOrProprietary = type.CdOrPrtry;
        if (isObj(codeOrProprietary)) {
          const code = readRaw(codeOrProprietary.Cd);
          if (code) details.creditorReferenceTypeCode = code;
          const proprietary = readRaw(codeOrProprietary.Prtry);
          if (proprietary) details.creditorReferenceTypeProprietary = proprietary;
        }
        const issuer = readRaw(type.Issr);
        if (issuer) details.creditorReferenceIssuer = issuer;
      }
      const reference = readRaw(creditorReferenceInformation.Ref);
      if (reference) details.creditorReference = reference;
    }
    const additional = asArray(structured.AddtlRmtInf).map(readRaw).filter(isString);
    if (additional.length) details.additionalRemittanceInfo = additional;
    if (Object.keys(details).length) out.structured = details;
  }

  return Object.keys(out).length ? out : null;
}

function readStatusReasons(node: unknown): ParsedStatusReason[] {
  return asArray(node)
    .map((entry): ParsedStatusReason | null => {
      if (!isObj(entry)) return null;
      const reason: ParsedStatusReason = {};
      const source = entry.Rsn;
      if (isObj(source)) {
        const code = readRaw(source.Cd);
        if (code) reason.code = code;
        const proprietary = readRaw(source.Prtry);
        if (proprietary) reason.proprietary = proprietary;
      }
      const additional = asArray(entry.AddtlInf).map(readRaw).filter(isString);
      if (additional.length) reason.additionalInformation = additional;
      return Object.keys(reason).length ? reason : null;
    })
    .filter((reason): reason is ParsedStatusReason => reason !== null);
}

function readTransactionsPerStatus(node: unknown, warnings: string[]): Array<{ number: number; status: string; controlSum: number | null }> {
  return asArray(node)
    .map((entry) => {
      if (!isObj(entry)) return null;
      const number = readNumber(entry.DtldNbOfTxs, 'DtldNbOfTxs', warnings) ?? 0;
      const status = readRaw(entry.DtldSts) ?? '';
      const controlSum = readNumber(entry.DtldCtrlSum, 'DtldCtrlSum', warnings);
      return { number, status, controlSum };
    })
    .filter((entry): entry is { number: number; status: string; controlSum: number | null } => entry !== null);
}

/** PaymentTypeInformation29 / PaymentTypeInformation26 → the shared sub-set. */
function readPaymentTypeInformation(node: unknown): {
  priority: string | null;
  serviceLevel: string | null;
  localInstrument: string | null;
  sequenceType: string | null;
  categoryPurpose: string | null;
} {
  const empty = { priority: null, serviceLevel: null, localInstrument: null, sequenceType: null, categoryPurpose: null };
  if (!isObj(node)) return empty;

  const serviceLevel = asArray(node.SvcLvl)
    .map(entry => (isObj(entry) ? readRaw(entry.Cd) : undefined))
    .find(isString);

  const localInstrument = isObj(node.LclInstrm) ? readRaw(node.LclInstrm.Cd) : undefined;
  const categoryPurpose = isObj(node.CtgyPurp) ? readRaw(node.CtgyPurp.Cd) : undefined;

  return {
    priority: readRaw(node.InstrPrty) ?? null,
    serviceLevel: serviceLevel ?? null,
    localInstrument: localInstrument ?? null,
    sequenceType: readRaw(node.SeqTp) ?? null,
    categoryPurpose: categoryPurpose ?? null,
  };
}

function emptyTransaction(): ParsedIso20022Transaction {
  return {
    instructionId: null,
    endToEndId: null,
    uetr: null,
    amount: null,
    currency: null,
    status: null,
    statusReasons: [],
    mandateId: null,
    dateOfSignature: null,
    debtor: null,
    creditor: null,
    remittance: null,
  };
}

// ── Message specific readers ─────────────────────────────────────────────────

function parsePain001(root: Obj, parsed: ParsedIso20022Document): void {
  parsed.paymentInstructions = asArray(root.PmtInf).map((instruction): ParsedIso20022PaymentInstruction => {
    if (!isObj(instruction)) return emptyInstruction();
    const type = readPaymentTypeInformation(instruction.PmtTpInf);
    const executionDate = isObj(instruction.ReqdExctnDt) ? readRaw(instruction.ReqdExctnDt.Dt) : undefined;

    const transactions = asArray(instruction.CdtTrfTxInf).map((tx): ParsedIso20022Transaction => {
      if (!isObj(tx)) return emptyTransaction();
      const identification = isObj(tx.PmtId) ? tx.PmtId : {};
      const amount = readAmount(isObj(tx.Amt) ? tx.Amt.InstdAmt : undefined);
      const result = emptyTransaction();
      result.instructionId = readRaw(identification.InstrId) ?? null;
      result.endToEndId = readRaw(identification.EndToEndId) ?? null;
      result.uetr = readRaw(identification.UETR) ?? null;
      result.amount = amount ? amount.amount : null;
      result.currency = amount ? amount.currency : null;
      result.creditor = mergeParty(readParty(tx.Cdtr), readAccount(tx.CdtrAcct), readAgent(tx.CdtrAgt));
      result.remittance = readRemittance(tx.RmtInf);
      return result;
    });

    return {
      ...emptyInstruction(),
      paymentInfoId: readRaw(instruction.PmtInfId) ?? null,
      paymentMethod: readRaw(instruction.PmtMtd) ?? null,
      numberOfTransactions: readNumber(instruction.NbOfTxs, 'PmtInf.NbOfTxs', parsed.warnings),
      controlSum: readNumber(instruction.CtrlSum, 'PmtInf.CtrlSum', parsed.warnings),
      requestedExecutionDate: executionDate ?? null,
      batchBooking: readBoolean(instruction.BtchBookg),
      priority: type.priority,
      serviceLevel: type.serviceLevel,
      localInstrument: type.localInstrument,
      categoryPurpose: type.categoryPurpose,
      chargeBearer: readRaw(instruction.ChrgBr) ?? null,
      debtor: mergeParty(readParty(instruction.Dbtr), readAccount(instruction.DbtrAcct), readAgent(instruction.DbtrAgt)),
      transactions,
    };
  });
}

function parsePain002(root: Obj, parsed: ParsedIso20022Document): void {
  const group = isObj(root.OrgnlGrpInfAndSts) ? root.OrgnlGrpInfAndSts : {};
  parsed.originalMessageId = readRaw(group.OrgnlMsgId) ?? null;
  parsed.originalMessageNameId = readRaw(group.OrgnlMsgNmId) ?? null;
  parsed.originalCreationDateTime = readRaw(group.OrgnlCreDtTm) ?? null;
  parsed.originalNumberOfTransactions = readNumber(group.OrgnlNbOfTxs, 'OrgnlGrpInfAndSts.OrgnlNbOfTxs', parsed.warnings);
  parsed.originalControlSum = readNumber(group.OrgnlCtrlSum, 'OrgnlGrpInfAndSts.OrgnlCtrlSum', parsed.warnings);
  parsed.groupStatus = readRaw(group.GrpSts) ?? null;
  parsed.groupStatusReasons = readStatusReasons(group.StsRsnInf);

  parsed.paymentInstructions = asArray(root.OrgnlPmtInfAndSts).map((instruction): ParsedIso20022PaymentInstruction => {
    if (!isObj(instruction)) return emptyInstruction();

    const transactions = asArray(instruction.TxInfAndSts).map((tx): ParsedIso20022Transaction => {
      if (!isObj(tx)) return emptyTransaction();
      const result = emptyTransaction();
      result.instructionId = readRaw(tx.OrgnlInstrId) ?? null;
      result.endToEndId = readRaw(tx.OrgnlEndToEndId) ?? null;
      result.uetr = readRaw(tx.OrgnlUETR) ?? null;
      result.status = readRaw(tx.TxSts) ?? null;
      result.statusReasons = readStatusReasons(tx.StsRsnInf);

      const reference = isObj(tx.OrgnlTxRef) ? tx.OrgnlTxRef : null;
      if (reference) {
        const amount = readAmount(isObj(reference.Amt) ? reference.Amt.InstdAmt : reference.IntrBkSttlmAmt);
        if (amount) {
          result.amount = amount.amount;
          result.currency = amount.currency;
        }
        result.debtor = mergeParty(readAccount(reference.DbtrAcct), readAgent(reference.DbtrAgt));
        result.creditor = mergeParty(readAccount(reference.CdtrAcct), readAgent(reference.CdtrAgt));
        result.remittance = readRemittance(reference.RmtInf);
      }
      return result;
    });

    return {
      ...emptyInstruction(),
      originalPaymentInfoId: readRaw(instruction.OrgnlPmtInfId) ?? null,
      numberOfTransactions: readNumber(instruction.OrgnlNbOfTxs, 'OrgnlPmtInfAndSts.OrgnlNbOfTxs', parsed.warnings),
      controlSum: readNumber(instruction.OrgnlCtrlSum, 'OrgnlPmtInfAndSts.OrgnlCtrlSum', parsed.warnings),
      paymentInfoStatus: readRaw(instruction.PmtInfSts) ?? null,
      statusReasons: readStatusReasons(instruction.StsRsnInf),
      transactionsPerStatus: readTransactionsPerStatus(instruction.NbOfTxsPerSts, parsed.warnings),
      transactions,
    };
  });
}

function parsePain007(root: Obj, parsed: ParsedIso20022Document): void {
  const group = isObj(root.OrgnlGrpInf) ? root.OrgnlGrpInf : {};
  parsed.originalMessageId = readRaw(group.OrgnlMsgId) ?? null;
  parsed.originalMessageNameId = readRaw(group.OrgnlMsgNmId) ?? null;
  parsed.originalCreationDateTime = readRaw(group.OrgnlCreDtTm) ?? null;
  parsed.groupStatusReasons = readStatusReasons(group.RvslRsnInf);

  parsed.paymentInstructions = asArray(root.OrgnlPmtInfAndRvsl).map((instruction): ParsedIso20022PaymentInstruction => {
    if (!isObj(instruction)) return emptyInstruction();

    const transactions = asArray(instruction.TxInf).map((tx): ParsedIso20022Transaction => {
      if (!isObj(tx)) return emptyTransaction();
      const result = emptyTransaction();
      result.instructionId = readRaw(tx.OrgnlInstrId) ?? null;
      result.endToEndId = readRaw(tx.OrgnlEndToEndId) ?? null;
      result.uetr = readRaw(tx.OrgnlUETR) ?? null;
      result.statusReasons = readStatusReasons(tx.RvslRsnInf);

      const amount = readAmount(tx.RvsdInstdAmt) ?? readAmount(tx.OrgnlInstdAmt);
      if (amount) {
        result.amount = amount.amount;
        result.currency = amount.currency;
      }

      const reference = isObj(tx.OrgnlTxRef) ? tx.OrgnlTxRef : null;
      if (reference) {
        result.debtor = mergeParty(readAccount(reference.DbtrAcct), readAgent(reference.DbtrAgt));
        result.creditor = mergeParty(readAccount(reference.CdtrAcct), readAgent(reference.CdtrAgt));
        result.remittance = readRemittance(reference.RmtInf);
      }
      return result;
    });

    return {
      ...emptyInstruction(),
      originalPaymentInfoId: readRaw(instruction.OrgnlPmtInfId) ?? null,
      reversalPaymentInfoId: readRaw(instruction.RvslPmtInfId) ?? null,
      numberOfTransactions: readNumber(instruction.OrgnlNbOfTxs, 'OrgnlPmtInfAndRvsl.OrgnlNbOfTxs', parsed.warnings),
      controlSum: readNumber(instruction.OrgnlCtrlSum, 'OrgnlPmtInfAndRvsl.OrgnlCtrlSum', parsed.warnings),
      batchBooking: readBoolean(instruction.BtchBookg),
      paymentInfoReversal: readBoolean(instruction.PmtInfRvsl),
      statusReasons: readStatusReasons(instruction.RvslRsnInf),
      transactions,
    };
  });
}

function parsePain008(root: Obj, parsed: ParsedIso20022Document): void {
  parsed.paymentInstructions = asArray(root.PmtInf).map((instruction): ParsedIso20022PaymentInstruction => {
    if (!isObj(instruction)) return emptyInstruction();
    const type = readPaymentTypeInformation(instruction.PmtTpInf);

    const transactions = asArray(instruction.DrctDbtTxInf).map((tx): ParsedIso20022Transaction => {
      if (!isObj(tx)) return emptyTransaction();
      const identification = isObj(tx.PmtId) ? tx.PmtId : {};
      const amount = readAmount(tx.InstdAmt);
      const result = emptyTransaction();
      result.instructionId = readRaw(identification.InstrId) ?? null;
      result.endToEndId = readRaw(identification.EndToEndId) ?? null;
      result.uetr = readRaw(identification.UETR) ?? null;
      result.amount = amount ? amount.amount : null;
      result.currency = amount ? amount.currency : null;

      const directDebit = isObj(tx.DrctDbtTx) ? tx.DrctDbtTx : null;
      if (directDebit) {
        const mandate = isObj(directDebit.MndtRltdInf) ? directDebit.MndtRltdInf : null;
        if (mandate) {
          result.mandateId = readRaw(mandate.MndtId) ?? null;
          result.dateOfSignature = readRaw(mandate.DtOfSgntr) ?? null;
        }
      }

      result.debtor = mergeParty(readParty(tx.Dbtr), readAccount(tx.DbtrAcct), readAgent(tx.DbtrAgt));
      result.creditor = mergeParty(readParty(tx.UltmtCdtr), readAgent(tx.CdtrAgt));
      result.remittance = readRemittance(tx.RmtInf);
      return result;
    });

    return {
      ...emptyInstruction(),
      paymentInfoId: readRaw(instruction.PmtInfId) ?? null,
      paymentMethod: readRaw(instruction.PmtMtd) ?? null,
      numberOfTransactions: readNumber(instruction.NbOfTxs, 'PmtInf.NbOfTxs', parsed.warnings),
      controlSum: readNumber(instruction.CtrlSum, 'PmtInf.CtrlSum', parsed.warnings),
      requestedCollectionDate: readRaw(instruction.ReqdColltnDt) ?? null,
      batchBooking: readBoolean(instruction.BtchBookg),
      priority: type.priority,
      serviceLevel: type.serviceLevel,
      localInstrument: type.localInstrument,
      sequenceType: type.sequenceType,
      categoryPurpose: type.categoryPurpose,
      chargeBearer: readRaw(instruction.ChrgBr) ?? null,
      creditor: mergeParty(readParty(instruction.Cdtr), readAccount(instruction.CdtrAcct), readAgent(instruction.CdtrAgt)),
      transactions,
    };
  });
}

function emptyInstruction(): ParsedIso20022PaymentInstruction {
  return {
    paymentInfoId: null,
    originalPaymentInfoId: null,
    reversalPaymentInfoId: null,
    paymentMethod: null,
    numberOfTransactions: null,
    controlSum: null,
    requestedExecutionDate: null,
    requestedCollectionDate: null,
    batchBooking: null,
    paymentInfoStatus: null,
    paymentInfoReversal: null,
    priority: null,
    serviceLevel: null,
    localInstrument: null,
    sequenceType: null,
    categoryPurpose: null,
    chargeBearer: null,
    debtor: null,
    creditor: null,
    statusReasons: [],
    transactionsPerStatus: [],
    transactions: [],
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** Parses an ISO 20022 payments-initiation document into a flat, typed view. */
export function parseIso20022Document(xml: string): ParsedIso20022Document {
  const source = String(xml ?? '');
  if (!source.trim()) throw new Error('Empty ISO 20022 document');

  const schema = detectMessageType(source);

  let tree: Obj;
  try {
    const result = xmlParser.parse(source);
    if (!isObj(result)) throw new Error('the document is not a well-formed XML object');
    tree = result;
  } catch (error: any) {
    throw new Error(`Malformed ISO 20022 XML: ${error?.message || 'unable to parse'}`);
  }

  const documentNode = isObj(tree.Document) ? tree.Document : tree;
  if (!isObj(documentNode)) throw new Error('Malformed ISO 20022 document: <Document> is empty');

  if (!documentNode[schema.rootElement]) {
    throw new Error(`Malformed ${schema.messageType} document: <${schema.rootElement}> is missing`);
  }
  const root = documentNode[schema.rootElement] as Obj;

  const header = isObj(root.GrpHdr) ? root.GrpHdr : {};
  const warnings: string[] = [];

  const parsed: ParsedIso20022Document = {
    messageType: schema.messageType,
    messageName: schema.messageName,
    namespace: schema.namespace,
    rootElement: schema.rootElement,
    messageId: readRaw(header.MsgId) ?? null,
    creationDateTime: readRaw(header.CreDtTm) ?? null,
    numberOfTransactions: readNumber(header.NbOfTxs, 'GrpHdr.NbOfTxs', warnings),
    controlSum: readNumber(header.CtrlSum, 'GrpHdr.CtrlSum', warnings),
    initiatingParty: isObj(header.InitgPty) ? readRaw(header.InitgPty.Nm) ?? null : null,
    originalMessageId: null,
    originalMessageNameId: null,
    originalCreationDateTime: null,
    originalNumberOfTransactions: null,
    originalControlSum: null,
    groupStatus: null,
    groupReversal: readBoolean(header.GrpRvsl),
    groupStatusReasons: [],
    paymentInstructions: [],
    warnings,
  };

  switch (schema.messageType) {
    case 'pain.001.001.13':
      parsePain001(root, parsed);
      break;
    case 'pain.002.001.15':
      parsePain002(root, parsed);
      break;
    case 'pain.007.001.13':
      parsePain007(root, parsed);
      break;
    case 'pain.008.001.12':
      parsePain008(root, parsed);
      break;
    default: {
      const exhaustive: never = schema.messageType;
      throw new Error(`No parser registered for ${exhaustive}`);
    }
  }

  // Header vs body consistency — reported, never silently corrected.
  const bodyTransactions = parsed.paymentInstructions.reduce(
    (total, instruction) => total + instruction.transactions.length,
    0
  );
  if (parsed.numberOfTransactions !== null && parsed.numberOfTransactions !== bodyTransactions) {
    warnings.push(`GrpHdr.NbOfTxs is ${parsed.numberOfTransactions} but the body contains ${bodyTransactions} transaction(s)`);
  }
  if (parsed.messageType === 'pain.008.001.12' && schema.rootElement !== 'CstmrDrctDbtInitn') {
    warnings.push('Direct debit document does not use the expected root element');
  }

  return parsed;
}

/** Message-type aware convenience wrapper (validates the type first). */
export function parseIso20022DocumentAs(xml: string, messageType: string): ParsedIso20022Document {
  getMessageSchema(messageType);
  const parsed = parseIso20022Document(xml);
  if (parsed.messageType !== messageType) {
    throw new Error(`Expected ${messageType} but the document is a ${parsed.messageType}`);
  }
  return parsed;
}
