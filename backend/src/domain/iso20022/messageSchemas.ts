import fs from 'fs';
import path from 'path';

/**
 * Registry of the ISO 20022 Payments Initiation messages implemented by the
 * processor. The XSDs are the authoritative artefacts published with the
 * 2025/2026 Payments Initiation MDR (Payments SEG, approved 12 Jan 2026) and
 * are shipped verbatim in `backend/iso20022-schemas/`.
 */
export type Iso20022MessageType =
  | 'pain.001.001.13'
  | 'pain.002.001.15'
  | 'pain.007.001.13'
  | 'pain.008.001.12';

export type Iso20022Direction = 'OUTBOUND' | 'INBOUND';

export interface Iso20022MessageSchema {
  messageType: Iso20022MessageType;
  /** ISO 20022 message definition name. */
  messageName: string;
  /** Root element inside the `Document` wrapper. */
  rootElement: string;
  namespace: string;
  direction: 'BOTH' | Iso20022Direction;
  purpose: string;
  xsdFile: string;
}

/** Resolves the directory that holds the published XSDs. */
function resolveSchemaDir(): string {
  const candidates = [
    process.env.ISO20022_SCHEMA_DIR,
    path.resolve(__dirname, '..', '..', '..', 'iso20022-schemas'),
    path.resolve(process.cwd(), 'iso20022-schemas'),
    path.resolve(process.cwd(), 'backend', 'iso20022-schemas'),
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return candidates[candidates.length - 1];
}

export const ISO20022_SCHEMA_DIR = resolveSchemaDir();

const registry: Record<Iso20022MessageType, Iso20022MessageSchema> = {
  'pain.001.001.13': {
    messageType: 'pain.001.001.13',
    messageName: 'CustomerCreditTransferInitiationV13',
    rootElement: 'CstmrCdtTrfInitn',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.13',
    direction: 'OUTBOUND',
    purpose: 'Customer credit transfer initiation sent to the account servicing institution.',
    xsdFile: path.join(ISO20022_SCHEMA_DIR, 'pain.001.001.13.xsd'),
  },
  'pain.002.001.15': {
    messageType: 'pain.002.001.15',
    messageName: 'CustomerPaymentStatusReportV15',
    rootElement: 'CstmrPmtStsRpt',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.002.001.15',
    direction: 'BOTH',
    purpose: 'Payment status report (RCVD/ACTC/ACSP/ACSC/RJCT/PDNG) referencing an original pain.001/pain.008.',
    xsdFile: path.join(ISO20022_SCHEMA_DIR, 'pain.002.001.15.xsd'),
  },
  'pain.007.001.13': {
    messageType: 'pain.007.001.13',
    messageName: 'CustomerPaymentReversalV13',
    rootElement: 'CstmrPmtRvsl',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.007.001.13',
    direction: 'BOTH',
    purpose: 'Request to cancel/reverse a previously sent customer payment initiation.',
    xsdFile: path.join(ISO20022_SCHEMA_DIR, 'pain.007.001.13.xsd'),
  },
  'pain.008.001.12': {
    messageType: 'pain.008.001.12',
    messageName: 'CustomerDirectDebitInitiationV12',
    rootElement: 'CstmrDrctDbtInitn',
    namespace: 'urn:iso:std:iso:20022:tech:xsd:pain.008.001.12',
    direction: 'BOTH',
    purpose: 'Customer direct debit initiation (mandate-backed collection).',
    xsdFile: path.join(ISO20022_SCHEMA_DIR, 'pain.008.001.12.xsd'),
  },
};

export const ISO20022_MESSAGE_TYPES = Object.keys(registry) as Iso20022MessageType[];

/** Result of serialising a message — the header facts the API and persistence layer need. */
export interface BuiltIso20022Message {
  messageType: Iso20022MessageType;
  messageName: string;
  /** GrpHdr/MsgId */
  messageId: string;
  /** GrpHdr/CreDtTm */
  creationDateTime: string;
  /** GrpHdr/NbOfTxs */
  numberOfTransactions: number;
  /** GrpHdr/CtrlSum (null when the message type carries no control sum) */
  controlSum: number | null;
  /** Single control currency, or null for multi-currency documents. */
  currency: string | null;
  /** GrpHdr/InitgPty/Nm when supplied. */
  initiatingParty: string | null;
  xml: string;
}

export function getMessageSchema(messageType: string): Iso20022MessageSchema {
  const schema = registry[String(messageType).trim() as Iso20022MessageType];
  if (!schema) {
    throw new Error(
      `Unsupported ISO 20022 message type "${messageType}". Supported: ${ISO20022_MESSAGE_TYPES.join(', ')}`
    );
  }
  if (!fs.existsSync(schema.xsdFile)) {
    throw new Error(`XSD not found for ${schema.messageType} at ${schema.xsdFile}`);
  }
  return schema;
}

export function describeSchemas(): Array<Omit<Iso20022MessageSchema, 'xsdFile'> & { xsdFile: string; xsdPresent: boolean }> {
  return ISO20022_MESSAGE_TYPES.map((messageType) => {
    const schema = registry[messageType];
    return { ...schema, xsdPresent: fs.existsSync(schema.xsdFile) };
  });
}

/**
 * Identifies the ISO 20022 message type of an inbound document.
 * The namespace is authoritative; the root element is used as a fallback for
 * documents that omit the namespace declaration.
 */
export function detectMessageType(xml: string): Iso20022MessageSchema {
  const source = String(xml ?? '');
  if (!source.trim()) throw new Error('Empty ISO 20022 document');

  const nsMatch = source.match(/xmlns\s*=\s*["']([^"']*urn:iso:std:iso:20022:tech:xsd:[^"']+)["']/i);
  const namespace = nsMatch ? nsMatch[1].trim() : '';

  if (namespace) {
    const found = ISO20022_MESSAGE_TYPES.find(t => registry[t].namespace === namespace);
    if (!found) {
      throw new Error(`Unsupported ISO 20022 namespace "${namespace}". Supported: ${ISO20022_MESSAGE_TYPES.join(', ')}`);
    }
    return registry[found];
  }

  const found = ISO20022_MESSAGE_TYPES.find(t => new RegExp(`<${registry[t].rootElement}[\\s>]`).test(source));
  if (found) return registry[found];

  throw new Error('Unable to determine the ISO 20022 message type: no recognised namespace or root element');
}
