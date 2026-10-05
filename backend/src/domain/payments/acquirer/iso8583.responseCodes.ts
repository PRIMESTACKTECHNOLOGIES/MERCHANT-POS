/**
 * ISO 8583 Response Code Reference
 * ─────────────────────────────────────────────────────────────────────────────
 * Complete DE39 response code table covering:
 *   - ISO 8583:1993 standard codes
 *   - Visa-specific codes
 *   - Mastercard-specific codes
 *   - Private-use codes used by this processor
 *
 * Used by:
 *   - iso8583-acquirer.client.ts   (TypeScript acquirer client)
 *   - vault-bank-acquirer.client.ts (pipe-delimited TCP client)
 *   - vault-bank-acquirer.js        (acquirer server — mapResponseCode)
 */

export interface ResponseCodeInfo {
  code:        string;
  description: string;
  action:      'APPROVE' | 'DECLINE' | 'REFERRAL' | 'PARTIAL' | 'ERROR' | 'CAPTURE_CARD';
  retryable:   boolean;   // caller may retry the same transaction
  issuerRetry: boolean;   // cardholder may retry with the same card
  /** Which networks emit this code (empty = all) */
  networks?:   ('VISA' | 'MASTERCARD' | 'AMEX' | 'DISCOVER' | 'ISO')[];
}

export const ISO8583_RESPONSE_CODES: Record<string, ResponseCodeInfo> = {

  // ── Approvals ──────────────────────────────────────────────────────────────
  '00': { code: '00', description: 'Approved',                                                      action: 'APPROVE',      retryable: false, issuerRetry: false },
  '08': { code: '08', description: 'Honor with identification',                                     action: 'APPROVE',      retryable: false, issuerRetry: false },
  '10': { code: '10', description: 'Partial approval — approved amount less than requested',        action: 'PARTIAL',      retryable: false, issuerRetry: false },
  '11': { code: '11', description: 'VIP approval',                                                  action: 'APPROVE',      retryable: false, issuerRetry: false, networks: ['VISA'] },
  '85': { code: '85', description: 'No reason to decline (card verification only)',                  action: 'APPROVE',      retryable: false, issuerRetry: false },
  '87': { code: '87', description: 'Purchase approved',                                             action: 'APPROVE',      retryable: false, issuerRetry: false, networks: ['VISA'] },

  // ── Referrals (call issuer) ────────────────────────────────────────────────
  '01': { code: '01', description: 'Refer to card issuer',                                          action: 'REFERRAL',     retryable: false, issuerRetry: true  },
  '02': { code: '02', description: 'Refer to card issuer — special condition',                      action: 'REFERRAL',     retryable: false, issuerRetry: true  },
  '07': { code: '07', description: 'Pick up card — special condition (honor with identification)',  action: 'CAPTURE_CARD', retryable: false, issuerRetry: false },
  '79': { code: '79', description: 'Already reversed (Visa) / Life cycle (MC)',                    action: 'DECLINE',      retryable: false, issuerRetry: false },

  // ── Hard declines — do not retry same card ─────────────────────────────────
  '03': { code: '03', description: 'Invalid merchant',                                              action: 'ERROR',        retryable: false, issuerRetry: false },
  '04': { code: '04', description: 'Pick up card (no fraud)',                                       action: 'CAPTURE_CARD', retryable: false, issuerRetry: false },
  '05': { code: '05', description: 'Do not honor',                                                  action: 'DECLINE',      retryable: false, issuerRetry: false },
  '06': { code: '06', description: 'Error',                                                         action: 'ERROR',        retryable: true,  issuerRetry: false },
  '12': { code: '12', description: 'Invalid transaction',                                           action: 'DECLINE',      retryable: false, issuerRetry: false },
  '13': { code: '13', description: 'Invalid amount',                                                action: 'DECLINE',      retryable: false, issuerRetry: false },
  '14': { code: '14', description: 'Invalid card number — no such number',                         action: 'DECLINE',      retryable: false, issuerRetry: false },
  '15': { code: '15', description: 'No such issuer',                                               action: 'DECLINE',      retryable: false, issuerRetry: false },
  '19': { code: '19', description: 'Re-enter transaction',                                          action: 'ERROR',        retryable: true,  issuerRetry: false },
  '25': { code: '25', description: 'Unable to locate record on file',                              action: 'DECLINE',      retryable: false, issuerRetry: false },
  '28': { code: '28', description: 'File is temporarily unavailable',                              action: 'ERROR',        retryable: true,  issuerRetry: false },
  '30': { code: '30', description: 'Format error',                                                  action: 'ERROR',        retryable: false, issuerRetry: false },
  '31': { code: '31', description: 'Bank not supported by switch',                                  action: 'DECLINE',      retryable: false, issuerRetry: false },
  '33': { code: '33', description: 'Expired card — pick up',                                       action: 'CAPTURE_CARD', retryable: false, issuerRetry: false },
  '34': { code: '34', description: 'Suspected fraud — pick up',                                    action: 'CAPTURE_CARD', retryable: false, issuerRetry: false },
  '35': { code: '35', description: 'Card acceptor contact acquirer — pick up',                     action: 'CAPTURE_CARD', retryable: false, issuerRetry: false },
  '36': { code: '36', description: 'Restricted card — pick up',                                    action: 'CAPTURE_CARD', retryable: false, issuerRetry: false },
  '37': { code: '37', description: 'Card acceptor call acquirer security — pick up',               action: 'CAPTURE_CARD', retryable: false, issuerRetry: false },
  '38': { code: '38', description: 'Allowable PIN tries exceeded — pick up',                       action: 'CAPTURE_CARD', retryable: false, issuerRetry: false },
  '39': { code: '39', description: 'No credit account',                                             action: 'DECLINE',      retryable: false, issuerRetry: false },
  '40': { code: '40', description: 'Requested function not supported',                              action: 'DECLINE',      retryable: false, issuerRetry: false },
  '41': { code: '41', description: 'Lost card — pick up',                                          action: 'CAPTURE_CARD', retryable: false, issuerRetry: false },
  '42': { code: '42', description: 'No universal account',                                          action: 'DECLINE',      retryable: false, issuerRetry: false },
  '43': { code: '43', description: 'Stolen card — pick up',                                        action: 'CAPTURE_CARD', retryable: false, issuerRetry: false },
  '44': { code: '44', description: 'No investment account',                                         action: 'DECLINE',      retryable: false, issuerRetry: false },
  '51': { code: '51', description: 'Not sufficient funds',                                          action: 'DECLINE',      retryable: false, issuerRetry: true  },
  '52': { code: '52', description: 'No checking account',                                           action: 'DECLINE',      retryable: false, issuerRetry: false },
  '53': { code: '53', description: 'No savings account',                                            action: 'DECLINE',      retryable: false, issuerRetry: false },
  '54': { code: '54', description: 'Expired card',                                                  action: 'DECLINE',      retryable: false, issuerRetry: false },
  '55': { code: '55', description: 'Incorrect personal identification number / EMV cryptogram fail', action: 'DECLINE',     retryable: false, issuerRetry: true  },
  '56': { code: '56', description: 'No card record',                                                action: 'DECLINE',      retryable: false, issuerRetry: false },
  '57': { code: '57', description: 'Transaction not permitted to cardholder',                       action: 'DECLINE',      retryable: false, issuerRetry: false },
  '58': { code: '58', description: 'Transaction not permitted to terminal',                         action: 'DECLINE',      retryable: false, issuerRetry: false },
  '59': { code: '59', description: 'Suspected fraud',                                               action: 'DECLINE',      retryable: false, issuerRetry: false },
  '60': { code: '60', description: 'Card acceptor contact acquirer',                                action: 'REFERRAL',     retryable: false, issuerRetry: false },
  '61': { code: '61', description: 'Exceeds withdrawal amount limit',                               action: 'DECLINE',      retryable: false, issuerRetry: true  },
  '62': { code: '62', description: 'Restricted card',                                               action: 'DECLINE',      retryable: false, issuerRetry: false },
  '63': { code: '63', description: 'Security violation',                                            action: 'DECLINE',      retryable: false, issuerRetry: false },
  '64': { code: '64', description: 'Original amount incorrect',                                     action: 'ERROR',        retryable: false, issuerRetry: false },
  '65': { code: '65', description: 'Exceeds withdrawal frequency limit',                            action: 'DECLINE',      retryable: false, issuerRetry: true  },
  '66': { code: '66', description: 'Card acceptor call acquirer security',                          action: 'REFERRAL',     retryable: false, issuerRetry: false },
  '67': { code: '67', description: 'Hard capture (ATM — pick up card)',                             action: 'CAPTURE_CARD', retryable: false, issuerRetry: false },
  '68': { code: '68', description: 'Response received too late',                                    action: 'ERROR',        retryable: true,  issuerRetry: false },
  '75': { code: '75', description: 'Allowable number of PIN tries exceeded',                        action: 'DECLINE',      retryable: false, issuerRetry: true  },
  '76': { code: '76', description: 'Invalid/non-existent "To Account" specified',                   action: 'DECLINE',      retryable: false, issuerRetry: false },
  '77': { code: '77', description: 'Invalid/non-existent "From Account" specified',                 action: 'DECLINE',      retryable: false, issuerRetry: false },
  '78': { code: '78', description: 'Invalid/non-existent account specified (general)',              action: 'DECLINE',      retryable: false, issuerRetry: false },
  '80': { code: '80', description: 'Invalid date',                                                  action: 'ERROR',        retryable: false, issuerRetry: false },
  '81': { code: '81', description: 'PIN cryptographic error found (error found by VS)',             action: 'ERROR',        retryable: false, issuerRetry: false, networks: ['VISA'] },
  '82': { code: '82', description: 'Incorrect CVV',                                                action: 'DECLINE',      retryable: false, issuerRetry: false },
  '83': { code: '83', description: 'Unable to verify PIN',                                         action: 'DECLINE',      retryable: true,  issuerRetry: false },
  '84': { code: '84', description: 'Invalid authorization life cycle',                              action: 'DECLINE',      retryable: false, issuerRetry: false },
  '86': { code: '86', description: 'Cannot verify PIN',                                            action: 'DECLINE',      retryable: false, issuerRetry: false },
  '88': { code: '88', description: 'Cryptographic failure',                                        action: 'ERROR',        retryable: false, issuerRetry: false },
  '89': { code: '89', description: 'Authentication failure',                                       action: 'DECLINE',      retryable: false, issuerRetry: false },

  // ── System / switch errors ─────────────────────────────────────────────────
  '90': { code: '90', description: 'Cutoff in progress',                                            action: 'ERROR',        retryable: true,  issuerRetry: false },
  '91': { code: '91', description: 'Card issuer or switch inoperative',                             action: 'ERROR',        retryable: true,  issuerRetry: false },
  '92': { code: '92', description: 'Financial institution or intermediate network not found',       action: 'ERROR',        retryable: false, issuerRetry: false },
  '93': { code: '93', description: 'Transaction cannot be completed — violation of law',           action: 'DECLINE',      retryable: false, issuerRetry: false },
  '94': { code: '94', description: 'Duplicate transmission / MAC error',                           action: 'ERROR',        retryable: false, issuerRetry: false },
  '95': { code: '95', description: 'Reconcile error',                                              action: 'ERROR',        retryable: false, issuerRetry: false },
  '96': { code: '96', description: 'System malfunction',                                           action: 'ERROR',        retryable: true,  issuerRetry: false },

  // ── Visa-specific private codes ────────────────────────────────────────────
  'N3': { code: 'N3', description: 'Cash service not available',                                   action: 'DECLINE',      retryable: false, issuerRetry: false, networks: ['VISA'] },
  'N4': { code: 'N4', description: 'Cash request exceeds issuer limit',                            action: 'DECLINE',      retryable: false, issuerRetry: true,  networks: ['VISA'] },
  'N7': { code: 'N7', description: 'Decline for CVV2 failure',                                    action: 'DECLINE',      retryable: false, issuerRetry: false, networks: ['VISA'] },
  'P2': { code: 'P2', description: 'Invalid biller information',                                   action: 'DECLINE',      retryable: false, issuerRetry: false, networks: ['VISA'] },
  'P5': { code: 'P5', description: 'PIN change/unblock request declined',                         action: 'DECLINE',      retryable: false, issuerRetry: false, networks: ['VISA'] },
  'P6': { code: 'P6', description: 'Unsafe PIN',                                                   action: 'DECLINE',      retryable: false, issuerRetry: true,  networks: ['VISA'] },
  'Q1': { code: 'Q1', description: 'Card authentication failed',                                   action: 'DECLINE',      retryable: false, issuerRetry: false, networks: ['VISA'] },
  'R0': { code: 'R0', description: 'Stop payment order',                                           action: 'DECLINE',      retryable: false, issuerRetry: false, networks: ['VISA'] },
  'R1': { code: 'R1', description: 'Revocation of authorization order',                            action: 'DECLINE',      retryable: false, issuerRetry: false, networks: ['VISA'] },
  'R3': { code: 'R3', description: 'Revocation of all authorizations order',                       action: 'DECLINE',      retryable: false, issuerRetry: false, networks: ['VISA'] },
  'Z3': { code: 'Z3', description: 'Unable to go online — offline approved',                      action: 'APPROVE',      retryable: false, issuerRetry: false, networks: ['VISA'] },
};

// ── Lookup helpers ────────────────────────────────────────────────────────────

/** Get full info for a response code, or a sensible default for unknown codes. */
export function getResponseCodeInfo(code: string): ResponseCodeInfo {
  const clean = String(code ?? '').trim().toUpperCase();
  return ISO8583_RESPONSE_CODES[clean] ?? {
    code:        clean,
    description: `Unknown response code ${clean}`,
    action:      'DECLINE',
    retryable:   false,
    issuerRetry: false,
  };
}

/** True if the response code represents any form of approval (00, 10, 85, etc.) */
export function isApprovalCode(code: string): boolean {
  const info = getResponseCodeInfo(code);
  return info.action === 'APPROVE' || info.action === 'PARTIAL';
}

/** True if the cardholder should not retry with the same card */
export function isSoftDecline(code: string): boolean {
  const info = getResponseCodeInfo(code);
  return info.action === 'DECLINE' && info.issuerRetry;
}

/** True if the terminal should capture/retain the physical card */
export function shouldCaptureCard(code: string): boolean {
  return getResponseCodeInfo(code).action === 'CAPTURE_CARD';
}

/**
 * Human-readable decline reason suitable for a receipt or POS display.
 * Never exposes internal codes to the cardholder.
 */
export function getCardholderMessage(code: string): string {
  const info = getResponseCodeInfo(code);
  switch (info.action) {
    case 'APPROVE':       return 'Approved';
    case 'PARTIAL':       return 'Partially approved';
    case 'REFERRAL':      return 'Please call your bank';
    case 'CAPTURE_CARD':  return 'Card cannot be returned — contact your bank';
    case 'DECLINE':
      if (['54'].includes(code)) return 'Card expired';
      if (['51', '61', '65'].includes(code)) return 'Insufficient funds or limit reached';
      if (['55', '75'].includes(code)) return 'Incorrect PIN';
      if (['41', '43'].includes(code)) return 'Card reported lost or stolen';
      return 'Transaction declined — contact your bank';
    case 'ERROR':
    default:
      return 'Transaction could not be processed — please try again';
  }
}
