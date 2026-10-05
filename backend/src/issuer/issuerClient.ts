export type IssuerAuthorizationRequest = {
  panToken: string;
  amountMinor: number;
  currency: string;
  protocol: string;
};

export type IssuerAuthorization = {
  approved: boolean;
  authCode?: string;
  providerReference?: string;
  reason: string;
};

export interface IssuerClient {
  authorize(request: IssuerAuthorizationRequest): Promise<IssuerAuthorization>;
}

/**
 * A live issuer adapter must be supplied by the licensed processor integration.
 * The default deliberately declines instead of pretending that funds were authorized.
 */
export const issuerClient: IssuerClient = {
  async authorize() {
    return { approved: false, reason: 'ISSUER_PROVIDER_NOT_CONFIGURED' };
  },
};
