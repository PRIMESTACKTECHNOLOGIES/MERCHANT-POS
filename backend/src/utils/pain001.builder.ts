export interface Pain001Debtor {
  name: string;
  bic: string;
  iban: string;
}

export interface Pain001Transaction {
  instrId: string;
  endToEndId: string;
  amount: number;
  currency: string;
  creditorName: string;
  creditorIban: string;
  creditorBic: string;
  remittanceInfo: string;
}

export interface Pain001Args {
  msgId: string;
  createdAt: string;
  debtor: Pain001Debtor;
  transactions: Pain001Transaction[];
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildPain001Xml(args: Pain001Args): string {
  const { msgId, createdAt, debtor, transactions } = args;
  const nbOfTxs = transactions.length;
  const ctrlSum = transactions.reduce((s, t) => s + Number(t.amount || 0), 0);
  const ctrlSumStr = ctrlSum.toFixed(2);
  const pmtInfId = msgId.slice(0, 32);
  const datePart = createdAt.slice(0, 10);

  const txsXml = transactions.map((tx) => {
    const amt = Number(tx.amount).toFixed(2);
    return `      <CdtTrfTxInf>
        <PmtId>
          <InstrId>${escapeXml(tx.instrId)}</InstrId>
            <EndToEndId>${escapeXml(tx.endToEndId)}</EndToEndId>
        </PmtId>
        <PmtTpInf>
          <SvcLvl>
            <Cd>SEPA</Cd>
          </SvcLvl>
        </PmtTpInf>
        <Amt>
          <InstdAmt Ccy="${escapeXml(tx.currency || 'EUR')}">${amt}</InstdAmt>
        </Amt>
        <ChrgBr>SLEV</ChrgBr>
        <CdtrAgt>
          <FinInstnId>
            <BIC>${escapeXml(tx.creditorBic)}</BIC>
          </FinInstnId>
        </CdtrAgt>
        <Cdtr>
          <Nm>${escapeXml(tx.creditorName)}</Nm>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <IBAN>${escapeXml(tx.creditorIban)}</IBAN>
          </Id>
        </CdtrAcct>
        <RmtInf>
          <Ustrd>${escapeXml(tx.remittanceInfo)}</Ustrd>
        </RmtInf>
      </CdtTrfTxInf>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.13">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${escapeXml(msgId)}</MsgId>
      <CreDtTm>${escapeXml(createdAt)}</CreDtTm>
      <NbOfTxs>${nbOfTxs}</NbOfTxs>
      <CtrlSum>${ctrlSumStr}</CtrlSum>
      <InitgPty>
        <Nm>${escapeXml(debtor.name)}</Nm>
      </InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${pmtInfId}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${nbOfTxs}</NbOfTxs>
      <CtrlSum>${ctrlSumStr}</CtrlSum>
      <ReqdExctnDt>
        <Dt>${datePart}</Dt>
      </ReqdExctnDt>
      <Dbtr>
        <Nm>${escapeXml(debtor.name)}</Nm>
      </Dbtr>
      <DbtrAcct>
        <Id>
          <IBAN>${escapeXml(debtor.iban)}</IBAN>
        </Id>
      </DbtrAcct>
      <DbtrAgt>
        <FinInstnId>
          <BIC>${escapeXml(debtor.bic)}</BIC>
        </FinInstnId>
      </DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>
${txsXml}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;

  return xml;
}
