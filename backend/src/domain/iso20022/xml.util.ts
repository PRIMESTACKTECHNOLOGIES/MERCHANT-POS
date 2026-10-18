/**
 * ISO 20022 — shared XML primitives.
 *
 * Every helper here maps directly onto an official ISO 20022 datatype that is
 * declared in the XSDs shipped in `backend/iso20022-schemas/`:
 *
 *   Max35Text                       1..35 characters
 *   Max34Text                       1..34 characters
 *   Max70Text                       1..70 characters
 *   Max140Text                      1..140 characters
 *   Max15NumericText                [0-9]{1,15}
 *   ActiveOrHistoricCurrencyCode    [A-Z]{3}
 *   ActiveOrHistoricCurrencyAndAmount  decimal, ≤5 fraction digits, ≤18 total digits, >= 0, @Ccy required
 *   DecimalNumber                   decimal, ≤17 fraction digits, ≤18 total digits
 *   IBAN2007Identifier              [A-Z]{2}[0-9]{2}[a-zA-Z0-9]{1,30}
 *   BICFIDec2014Identifier          [A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?
 *   LEIIdentifier                   [A-Z0-9]{18}[0-9]{2}
 *   UUIDv4Identifier                8-4-4-4-12 lowercase uuid v4
 *   CountryCode                     [A-Z]{2}
 *   ISODate                         xs:date
 *   ISODateTime                     xs:dateTime (offset allowed)
 *
 * Values are validated *before* escaping, so a value that passes validation is
 * guaranteed to be schema-legal once serialised.
 */

export const ISO20022_NAMESPACE_PREFIX = 'urn:iso:std:iso:20022:tech:xsd:';
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

// ── Character / text primitives ──────────────────────────────────────────────

/** XML 1.0 legal character filter (drops NUL and the other forbidden controls). */
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(ILLEGAL_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Mandatory ISO 20022 text element (minLength 1, maxLength `max`). */
export function txt(value: unknown, max: number, field: string): string {
  const raw = String(value ?? '').replace(ILLEGAL_XML_CHARS, '').trim();
  if (!raw) throw new Error(`${field} is required`);
  if (raw.length > max) {
    throw new Error(`${field} must be at most ${max} characters (received ${raw.length})`);
  }
  return escapeXml(raw);
}

/** Optional ISO 20022 text element — returns '' when the value is absent. */
export function optTxt(value: unknown, max: number, field: string): string {
  const raw = String(value ?? '').replace(ILLEGAL_XML_CHARS, '').trim();
  if (!raw) return '';
  if (raw.length > max) {
    throw new Error(`${field} must be at most ${max} characters (received ${raw.length})`);
  }
  return escapeXml(raw);
}

/** Truncates to a maximum length without throwing — for values echoed back from payments. */
export function clampTxt(value: unknown, max: number, fallback = 'NOTPROVIDED'): string {
  const raw = String(value ?? '').replace(ILLEGAL_XML_CHARS, '').trim();
  if (!raw) return escapeXml(fallback);
  return escapeXml(raw.slice(0, max));
}

export function element(tag: string, value: string | null | undefined, indent = ''): string {
  if (value === null || value === undefined || value === '') return '';
  return `${indent}<${tag}>${value}</${tag}>`;
}

/** Validates a mandatory ISO 20022 code against its external/internal code list. */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  const candidate = String(value ?? '').trim().toUpperCase() as T;
  if (!allowed.includes(candidate)) {
    throw new Error(`${field} must be one of ${allowed.join(', ')} (received "${value}")`);
  }
  return candidate;
}

/** Same as {@link oneOf} but tolerates an absent value (returns null). */
export function optionalOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return oneOf(value, allowed, field);
}

/** Validates a free-form external code (external code lists are not enumerated in the XSD). */
export function externalCode(value: unknown, max: number, field: string): string {
  return txt(value, max, field);
}

// ── Numbers ──────────────────────────────────────────────────────────────────

/**
 * Serialises a JS number as a plain decimal string (never exponent notation),
 * with at most `maxFractionDigits` decimals and no trailing zeros.
 */
export function decimal(value: number, maxFractionDigits = 5, field = 'value'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  if (value < 0) throw new Error(`${field} must not be negative (received ${value})`);
  if (value >= 1e18) throw new Error(`${field} exceeds the ISO 20022 18-digit limit`);

  let out = value.toFixed(Math.max(0, Math.min(17, maxFractionDigits)));
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '');
  if (out === '' || out === '-') out = '0';
  return out;
}

/** `NbOfTxs` / `DtldNbOfTxs` — Max15NumericText. */
export function count(value: number, field = 'NbOfTxs'): string {
  const n = Math.trunc(value);
  if (!Number.isFinite(n) || n < 0 || n > 999999999999999) {
    throw new Error(`${field} must be a non-negative integer of at most 15 digits`);
  }
  return String(n);
}

// ── Currency ─────────────────────────────────────────────────────────────────

const CURRENCY_RE = /^[A-Z]{3}$/;

export function currency(value: unknown, field = 'currency'): string {
  const c = String(value ?? '').trim().toUpperCase();
  if (!CURRENCY_RE.test(c)) {
    throw new Error(`${field} must be a 3-letter ISO 4217 alpha code (received "${value}")`);
  }
  return c;
}

/**
 * `<Tag Ccy="EUR">123.45</Tag>` — ActiveOrHistoricCurrencyAndAmount.
 * Used for InstdAmt, IntrBkSttlmAmt, OrgnlInstdAmt, RvsdInstdAmt ...
 */
export function ccyAmount(tag: string, ccy: string, value: number, field = 'amount'): string {
  const code = currency(ccy, `${field}.Ccy`);
  return `<${tag} Ccy="${escapeXml(code)}">${decimal(value, 5, field)}</${tag}>`;
}

// ── Identifiers ──────────────────────────────────────────────────────────────

const IBAN_RE = /^[A-Z]{2}[0-9]{2}[A-Za-z0-9]{1,30}$/;
const BIC_RE = /^[A-Z0-9]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;
const LEI_RE = /^[A-Z0-9]{18}[0-9]{2}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
export const UUID_V4_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function isIban(value: unknown): boolean {
  return IBAN_RE.test(String(value ?? '').trim());
}

export function isBic(value: unknown): boolean {
  return BIC_RE.test(String(value ?? '').trim().toUpperCase());
}

export function iban(value: unknown, field = 'IBAN'): string {
  const s = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  if (!IBAN_RE.test(s)) throw new Error(`${field} is not a valid IBAN (received "${value}")`);
  return escapeXml(s);
}

export function bic(value: unknown, field = 'BIC'): string {
  const s = String(value ?? '').trim().toUpperCase();
  if (!BIC_RE.test(s)) throw new Error(`${field} is not a valid BIC (received "${value}")`);
  return escapeXml(s);
}

export function lei(value: unknown, field = 'LEI'): string {
  const s = String(value ?? '').trim().toUpperCase();
  if (!LEI_RE.test(s)) throw new Error(`${field} is not a valid LEI (received "${value}")`);
  return escapeXml(s);
}

export function countryCode(value: unknown, field = 'country'): string {
  const s = String(value ?? '').trim().toUpperCase();
  if (!COUNTRY_RE.test(s)) throw new Error(`${field} must be a 2-letter ISO 3166 code (received "${value}")`);
  return escapeXml(s);
}

/** UUIDv4Identifier — lowercase, canonical 8-4-4-4-12 form. */
export function uuidV4(value: unknown, field = 'UETR'): string {
  const s = String(value ?? '').trim().toLowerCase();
  if (!UUID_V4_RE.test(s)) throw new Error(`${field} must be a lowercase UUID v4 (received "${value}")`);
  return s;
}

// ── Dates & times ────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(value: string | Date, field = 'date'): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${field} is an invalid Date`);
    return value.toISOString().slice(0, 10);
  }
  const s = String(value ?? '').trim();
  if (!DATE_RE.test(s)) throw new Error(`${field} must be an ISO date (YYYY-MM-DD), received "${value}"`);
  const parsed = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== s) {
    throw new Error(`${field} is not a real calendar date (received "${value}")`);
  }
  return s;
}

/** ISODateTime with the local UTC offset, e.g. `2026-10-18T12:00:00+04:00`. */
export function isoDateTime(value: Date = new Date()): string {
  if (Number.isNaN(value.getTime())) throw new Error('isoDateTime received an invalid Date');
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  const offsetMinutes = -value.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return (
    `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}` +
    `T${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

export function today(field = 'date'): string {
  return isoDate(new Date(), field);
}

// ── Shared party / account / agent building blocks ───────────────────────────

/**
 * Account party description shared by pain.001 (Dbtr/Cdtr) and pain.008.
 * `iban` and `otherAccountId` are mutually exclusive; one is required whenever
 * an account block is emitted.
 */
export interface IsoAccountParty {
  name?: string;
  iban?: string;
  /** GenericAccountIdentification1/Id (Max34Text) — used when no IBAN is available. */
  otherAccountId?: string;
  /** AccountSchemeName1Choice/Prtry (Max35Text). */
  otherAccountScheme?: string;
  bic?: string;
  /** ClearingSystemMemberIdentification2/ClrSysId/Cd */
  clearingSystemCode?: string;
  /** ClearingSystemMemberIdentification2/MmbId (Max35Text) */
  clearingMemberId?: string;
  lei?: string;
  /** FinancialInstitutionIdentification23/Nm */
  agentName?: string;
  country?: string;
  townName?: string;
  /** Max70Text — up to 7 address lines are allowed; we emit at most 2. */
  addressLines?: string[];
  countryOfResidence?: string;
  /** CashAccount40/Nm (Max70Text) */
  accountName?: string;
  /** CashAccount40/Ccy */
  accountCurrency?: string;
}

function postalAddressXml(party: IsoAccountParty, indent: string): string {
  const lines = (party.addressLines || []).filter(Boolean).slice(0, 2);
  const has = party.country || party.townName || lines.length;
  if (!has) return '';
  const inner =
    element('TwnNm', optTxt(party.townName, 140, 'townName'), indent + '  ') +
    element('Ctry', party.country ? countryCode(party.country) : '', indent + '  ') +
    lines.map(l => element('AdrLine', optTxt(l, 70, 'addressLine'), indent + '  ')).join('');
  return `\n${indent}<PstlAdr>\n${inner}\n${indent}</PstlAdr>`;
}

/** PartyIdentification272 — order: Nm, PstlAdr, Id, CtryOfRes, CtctDtls. */
export function partyXml(tag: string, party: IsoAccountParty, indent = ''): string {
  const name = element('Nm', optTxt(party.name, 140, `${tag}.Nm`), indent + '  ');
  const addr = postalAddressXml(party, indent + '  ');
  const res = element('CtryOfRes', party.countryOfResidence ? countryCode(party.countryOfResidence) : '', indent + '  ');
  return `${indent}<${tag}>\n${name}${addr}${res}\n${indent}</${tag}>`;
}

/** CashAccount40 — order: Id, Tp, Ccy, Nm, Prxy. */
export function accountXml(tag: string, party: IsoAccountParty, indent = ''): string {
  let idXml = '';
  if (party.iban) {
    idXml = `${indent}  <Id>\n${indent}    <IBAN>${iban(party.iban, `${tag}.IBAN`)}</IBAN>\n${indent}  </Id>`;
  } else if (party.otherAccountId) {
    const scheme = party.otherAccountScheme
      ? `\n${indent}      <SchmeNm><Prtry>${optTxt(party.otherAccountScheme, 35, 'otherAccountScheme')}</Prtry></SchmeNm>`
      : '';
    idXml = `${indent}  <Id>\n${indent}    <Othr>\n${indent}      <Id>${optTxt(party.otherAccountId, 34, `${tag}.otherAccountId`)}</Id>${scheme}\n${indent}    </Othr>\n${indent}  </Id>`;
  } else {
    throw new Error(`${tag} requires iban or otherAccountId`);
  }
  const ccy = element('Ccy', party.accountCurrency ? currency(party.accountCurrency, `${tag}.Ccy`) : '', indent + '  ');
  const nm = element('Nm', optTxt(party.accountName, 70, `${tag}.Nm`), indent + '  ');
  return `${indent}<${tag}>\n${idXml}\n${ccy}${nm}\n${indent}</${tag}>`;
}

/** BranchAndFinancialInstitutionIdentification8 — order: FinInstnId(BICFI, ClrSysMmbId, LEI, Nm, PstlAdr, Othr), BrnchId. */
export function agentXml(tag: string, party: IsoAccountParty, indent = ''): string {
  const bicfi = element('BICFI', party.bic ? bic(party.bic, `${tag}.BIC`) : '', indent + '    ');
  let clrSys = '';
  if (party.clearingMemberId) {
    const sysId = party.clearingSystemCode
      ? `${indent}      <ClrSysId><Cd>${optTxt(party.clearingSystemCode, 5, 'clearingSystemCode')}</Cd></ClrSysId>\n`
      : '';
    clrSys = `${indent}    <ClrSysMmbId>\n${sysId}${indent}      <MmbId>${optTxt(party.clearingMemberId, 35, `${tag}.clearingMemberId`)}</MmbId>\n${indent}    </ClrSysMmbId>\n`;
  }
  const leiXml = element('LEI', party.lei ? lei(party.lei, `${tag}.LEI`) : '', indent + '    ');
  const nm = element('Nm', optTxt(party.agentName, 140, `${tag}.agentName`), indent + '    ');
  const addr = postalAddressXml(party, indent + '    ');

  if (!bicfi && !clrSys && !leiXml && !nm && !addr) {
    throw new Error(`${tag} requires bic, clearingMemberId or lei`);
  }
  return `${indent}<${tag}>\n${indent}  <FinInstnId>\n${bicfi}${clrSys}${leiXml}${nm}${addr}\n${indent}  </FinInstnId>\n${indent}</${tag}>`;
}

// ── Remittance ───────────────────────────────────────────────────────────────

/** `RemittanceInformation26` — identical in pain.001/002/007/008. */
export interface IsoRemittance {
  /** Ustrd (Max140Text, unbounded). */
  unstructured?: string[];
  structured?: {
    /** CreditorReferenceType3/Tp/CdOrPrtry/Cd — e.g. SCOR. */
    creditorReferenceTypeCode?: string;
    /** CreditorReferenceType3/Tp/CdOrPrtry/Prtry (Max35Text). */
    creditorReferenceTypeProprietary?: string;
    /** CreditorReferenceType3/Tp/Issr (Max35Text). */
    creditorReferenceIssuer?: string;
    /** CreditorReferenceInformation3/Ref (Max35Text). */
    creditorReference?: string;
    /** AddtlRmtInf (Max140Text, max 3). */
    additionalRemittanceInfo?: string[];
  };
}

/** `RemittanceInformation26` — order: Ustrd*, Strd*. */
export function remittanceXml(remittance: IsoRemittance | undefined, indent = ''): string {
  if (!remittance) return '';
  const unstructured = (remittance.unstructured || [])
    .filter(Boolean)
    .map(line => element('Ustrd', txt(line, 140, 'remittance.unstructured'), indent + '  '))
    .join('\n');

  let structured = '';
  const s = remittance.structured;
  if (s) {
    if (!s.creditorReferenceTypeCode && !s.creditorReferenceTypeProprietary && !s.creditorReference) {
      throw new Error('remittance.structured requires a creditor reference and its type');
    }
    const cdOrPrtry = s.creditorReferenceTypeCode
      ? `<Cd>${txt(s.creditorReferenceTypeCode, 4, 'creditorReferenceTypeCode')}</Cd>`
      : `<Prtry>${txt(s.creditorReferenceTypeProprietary, 35, 'creditorReferenceTypeProprietary')}</Prtry>`;
    const issr = element('Issr', s.creditorReferenceIssuer ? txt(s.creditorReferenceIssuer, 35, 'creditorReferenceIssuer') : '', indent + '      ');
    const ref = s.creditorReference
      ? element('Ref', txt(s.creditorReference, 35, 'creditorReference'), indent + '      ')
      : '';
    const additional = (s.additionalRemittanceInfo || [])
      .filter(Boolean)
      .slice(0, 3)
      .map(line => element('AddtlRmtInf', txt(line, 140, 'additionalRemittanceInfo'), indent + '      '))
      .join('\n');
    structured =
      `${indent}  <Strd>\n` +
      `${indent}    <CdtrRefInf>\n` +
      `${indent}      <Tp>\n${indent}        <CdOrPrtry>${cdOrPrtry}</CdOrPrtry>\n${issr}\n${indent}      </Tp>\n` +
      `${ref}\n` +
      `${indent}    </CdtrRefInf>\n` +
      (additional ? `${additional}\n` : '') +
      `${indent}  </Strd>`;
  }

  if (!unstructured && !structured) return '';
  const inner = [unstructured, structured].filter(Boolean).join('\n');
  return `${indent}<RmtInf>\n${inner}\n${indent}</RmtInf>`;
}

