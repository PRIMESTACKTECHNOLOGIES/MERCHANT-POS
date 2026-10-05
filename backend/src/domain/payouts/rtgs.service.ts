import { createHash } from 'crypto';

export interface RtgsPayment {
  messageId: string;
  uetr: string;
  valueDate: string;
  senderBic: string;
  senderName: string;
  senderAccount: string;
  beneficiaryBic: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  amount: number;
  currency: string;
  reference: string;
  purpose?: string;
}

export interface RtgsResult {
  message: string;
  format: 'RTGS_PACS008_XML';
  messageId: string;
  uetr: string;
  reference: string;
}

function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeDate(value: string): string {
  const date = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('valueDate must be YYYY-MM-DD');
  }
  return date;
}

export function generateRtgs(payment: RtgsPayment): RtgsResult {
  if (!payment.messageId) throw new Error('messageId is required');
  if (!payment.uetr) throw new Error('uetr is required');
  if (!payment.senderBic || !payment.beneficiaryBic) throw new Error('senderBic and beneficiaryBic are required');
  if (!payment.senderAccount || !payment.beneficiaryAccount) throw new Error('senderAccount and beneficiaryAccount are required');
  if (!payment.senderName || !payment.beneficiaryName) throw new Error('senderName and beneficiaryName are required');
  if (!Number.isFinite(payment.amount) || payment.amount <= 0) throw new Error('amount must be positive');
  if (!/^[A-Z]{3}$/.test(payment.currency)) throw new Error('currency must be a 3-letter ISO code');
  if (!payment.reference) throw new Error('reference is required');

  const valueDate = normalizeDate(payment.valueDate);
  const amount = payment.amount.toFixed(2);
  const checksum = createHash('sha256')
    .update(`${payment.messageId}|${payment.uetr}|${payment.reference}|${amount}|${payment.currency}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();

  const message = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>${xml(payment.messageId)}</MsgId>
      <CreDtTm>${xml(new Date().toISOString())}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>${amount}</CtrlSum>
      <SttlmInf><SttlmMtd>CLRG</SttlmMtd></SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <InstrId>${xml(payment.reference)}</InstrId>
        <EndToEndId>${xml(payment.reference)}</EndToEndId>
        <UETR>${xml(payment.uetr)}</UETR>
      </PmtId>
      <IntrBkSttlmAmt Ccy="${xml(payment.currency)}">${amount}</IntrBkSttlmAmt>
      <IntrBkSttlmDt>${valueDate}</IntrBkSttlmDt>
      <Dbtr>
        <Nm>${xml(payment.senderName)}</Nm>
        <Id><OrgId><AnyBIC>${xml(payment.senderBic)}</AnyBIC></OrgId></Id>
      </Dbtr>
      <DbtrAcct><Id><Othr><Id>${xml(payment.senderAccount)}</Id></Othr></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><BICFI>${xml(payment.senderBic)}</BICFI></FinInstnId></DbtrAgt>
      <CdtrAgt><FinInstnId><BICFI>${xml(payment.beneficiaryBic)}</BICFI></FinInstnId></CdtrAgt>
      <Cdtr>
        <Nm>${xml(payment.beneficiaryName)}</Nm>
        <Id><OrgId><AnyBIC>${xml(payment.beneficiaryBic)}</AnyBIC></OrgId></Id>
      </Cdtr>
      <CdtrAcct><Id><Othr><Id>${xml(payment.beneficiaryAccount)}</Id></Othr></Id></CdtrAcct>
      ${payment.purpose ? `<RmtInf><Ustrd>${xml(payment.purpose)}</Ustrd></RmtInf>` : ''}
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
  <SupplementaryData><Envlp><Checksum>${checksum}</Checksum></Envlp></SupplementaryData>
</Document>`;

  return {
    message,
    format: 'RTGS_PACS008_XML',
    messageId: payment.messageId,
    uetr: payment.uetr,
    reference: payment.reference,
  };
}
