/**
 * Acquirer Service Interface
 * ─────────────────────────────────────────────────────────────────────────────
 * Defines the contract for any acquirer implementation.
 * HTTP JSON client is the default. ISO 8583 TCP client is a drop-in replacement.
 */

// ── Authorization (101.1 voice / 101.6 online EMV) ──────────────────────────

export interface AcquirerAuthRequest {
  merchantAccount: string;
  amountMinor:     number;        // in cents — e.g. $25.00 = 2500
  currency:        string;        // 'USD', 'AED', 'ZAR', 'EUR'
  protocol:        '101.1' | '101.6';

  // 101.1 — Manual / voice auth fields
  cardNumber?:     string;        // PAN (full, only for 101.1 voice auth)
  expiry?:         string;        // MMYY
  cvv?:            string | null; // optional for 101.1

  // 101.6 — EMV chip online auth
  emvField55?:     string;        // hex-encoded EMV tag 55

  // optional extras
  stan?:           string;        // 6-digit STAN
  terminalId?:     string;
  posEntryMode?:   string;        // '01' manual, '05' chip, '91' contactless
}

export interface AcquirerAuthResponse {
  success:       boolean;
  responseCode:  string;          // '00' approved, '05' declined, '96' system error
  status:        'Approved' | 'Declined';
  authRef?:      string;          // acquirer reference for capture/reversal
  approvalCode?: string;          // 6-digit auth code
  message?:      string;
  raw?:          any;             // full acquirer response for audit
}

// ── Capture (201.3) ──────────────────────────────────────────────────────────

export interface AcquirerCaptureRequest {
  merchantAccount: string;
  amountMinor:     number;
  currency:        string;
  authRef:         string;        // from AcquirerAuthResponse
  protocol:        '201.3';
  stan?:           string;
  terminalId?:     string;
}

export interface AcquirerCaptureResponse {
  success:      boolean;
  responseCode: string;
  status:       'Captured' | 'Declined';
  captureRef?:  string;
  message?:     string;
  raw?:         any;
}

// ── Reversal ─────────────────────────────────────────────────────────────────

export interface AcquirerReversalRequest {
  merchantAccount: string;
  amountMinor:     number;
  currency:        string;
  authRef:         string;
  reason?:         string;
}

export interface AcquirerReversalResponse {
  success:      boolean;
  responseCode: string;
  reversalRef?: string;
  message?:     string;
}

// ── Interface ─────────────────────────────────────────────────────────────────

export interface IAcquirerClient {
  authorize(req: AcquirerAuthRequest):   Promise<AcquirerAuthResponse>;
  capture(req: AcquirerCaptureRequest):  Promise<AcquirerCaptureResponse>;
  reverse(req: AcquirerReversalRequest): Promise<AcquirerReversalResponse>;
}
