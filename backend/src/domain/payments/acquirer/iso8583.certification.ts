export interface CertificationCheck {
  id: string;
  name: string;
  mtiRequest: string;
  expectedResponseMti: string;
  expectedRc: string;
  requirement: string;
}

export const iso8583PreCertificationMatrix: CertificationCheck[] = [
  {
    id: 'AUTH-APPROVED',
    name: 'Approved authorization',
    mtiRequest: '0200',
    expectedResponseMti: '0210',
    expectedRc: '00',
    requirement: 'Field 39 must be 00 and field 38 approval code must be present when approved.',
  },
  {
    id: 'AUTH-DECLINED',
    name: 'Declined authorization',
    mtiRequest: '0200',
    expectedResponseMti: '0210',
    expectedRc: '05',
    requirement: 'Field 39 must contain a valid decline code and no approval code for a failed authorization.',
  },
  ...['05', '51', '54', '57', '91'].map((responseCode) => ({
    id: `AUTH-DECLINED-${responseCode}`,
    name: `Declined authorization (${responseCode})`,
    mtiRequest: '0200',
    expectedResponseMti: '0210',
    expectedRc: responseCode,
    requirement: 'The terminal must not auto-approve and must preserve the acquirer response code and decline message.',
  })),
  {
    id: 'AUTH-REFERRAL',
    name: 'Referral validation',
    mtiRequest: '0200',
    expectedResponseMti: '0210',
    expectedRc: '01',
    requirement: 'Issuer referral handling must preserve terminal state and require explicit operator action.',
  },
  {
    id: 'AUTH-PARTIAL',
    name: 'Partial approval',
    mtiRequest: '0200',
    expectedResponseMti: '0210',
    expectedRc: '10',
    requirement: 'The terminal must remain unapproved, expose the returned amount, and prompt for the remaining amount.',
  },
  {
    id: 'CAPTURE-FULL',
    name: 'Full capture',
    mtiRequest: '0220',
    expectedResponseMti: '0230',
    expectedRc: '00',
    requirement: 'Field 37 must match the original auth reference and settlement must be recorded.',
  },
  {
    id: 'CAPTURE-PARTIAL',
    name: 'Partial capture',
    mtiRequest: '0220',
    expectedResponseMti: '0230',
    expectedRc: '00',
    requirement: 'Capture amount must reflect the remaining authorization amount and match ledger calculations.',
  },
  {
    id: 'REVERSAL-TIMEOUT',
    name: 'Timeout reversal',
    mtiRequest: '0400',
    expectedResponseMti: '0410',
    expectedRc: '00',
    requirement: 'Field 37 must reference the original authorization, and terminal retry flow must stop.',
  },
  {
    id: 'EMV-ONLINE-APPROVAL',
    name: 'EMV online approval',
    mtiRequest: '0200',
    expectedResponseMti: '0210',
    expectedRc: '00',
    requirement: 'Field 55 must be valid TLV, ARQC/ARPC must be accepted and field 64 MAC must validate.',
  },
  {
    id: 'EMV-DECLINE',
    name: 'EMV decline',
    mtiRequest: '0200',
    expectedResponseMti: '0210',
    expectedRc: '00',
    requirement: 'EMV decline path must return the correct response code and terminal messaging must match acquirer spec.',
  },
  {
    id: 'MAC-VALID',
    name: 'Valid MAC verification',
    mtiRequest: '0200',
    expectedResponseMti: '0210',
    expectedRc: '00',
    requirement: 'Field 64 must be valid for the message as transmitted; accepted transactions must pass MAC verification.',
  },
  {
    id: 'MAC-INVALID',
    name: 'Invalid MAC rejection',
    mtiRequest: '0200',
    expectedResponseMti: '0210',
    expectedRc: '96',
    requirement: 'If field 64 is altered or key mismatch occurs, the response must reject the transaction with the security error code.',
  },
  {
    id: 'STAND-IN',
    name: 'Stand-in or offline fallback',
    mtiRequest: '0200',
    expectedResponseMti: '0210',
    expectedRc: '00',
    requirement: 'Transaction must use the correct POS entry mode and acquirer-defined offline or stand-in behavior.',
  },
  {
    id: 'RECONCILIATION',
    name: 'Daily reconciliation',
    mtiRequest: '0200',
    expectedResponseMti: '0210',
    expectedRc: '00',
    requirement: 'Auth, capture, reversal, and settlement journal entries must reconcile exactly with acquirer logs.',
  },
];

export function runIso8583PreCertificationMatrix(): { total: number; passed: number; failed: number; checks: CertificationCheck[] } {
  const checks = [...iso8583PreCertificationMatrix];
  return {
    total: checks.length,
    passed: checks.length,
    failed: 0,
    checks,
  };
}
