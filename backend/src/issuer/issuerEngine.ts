export type IssuerEngineResult = {
  approved: boolean;
  responseCode: string;
  authCode?: string;
  reason?: string;
};

export interface IssuerEngine {
  authorize(panReference: string, amountMinor: number, currencyCode: string): IssuerEngineResult;
}
