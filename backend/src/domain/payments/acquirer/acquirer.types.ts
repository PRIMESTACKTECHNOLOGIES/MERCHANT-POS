export interface AcquirerAuthRequest {
  merchantAccount: string;
  amountMinor: number;
  currency: string;
  cardNumber?: string;
  expiry?: string;
  cvv?: string | null;
  emvField55?: string;
  processingCode?: string;
  stan?: string;
  posConditionCode?: string;
  cardSequenceNumber?: string;
  protocol: '101.1' | '101.6';
}

export interface AcquirerAuthResponse {
  success: boolean;
  responseCode: string;
  status: 'Approved' | 'Declined' | 'Referral' | 'PartialApproval';
  approvedAmountMinor?: number;
  authRef?: string;
  approvalCode?: string;
  message?: string;
  /** True if the same transaction may be retried (system error, not a hard decline) */
  retryable?: boolean;
  /** True if the cardholder may retry with the same card at a later time */
  issuerRetry?: boolean;
}

export interface AcquirerCaptureRequest {
  merchantAccount: string;
  amountMinor: number;
  currency: string;
  authRef: string;
  protocol: '201.3';
}

export interface AcquirerCaptureResponse {
  success: boolean;
  responseCode: string;
  status: 'Captured' | 'Declined';
  captureRef?: string;
  message?: string;
}
