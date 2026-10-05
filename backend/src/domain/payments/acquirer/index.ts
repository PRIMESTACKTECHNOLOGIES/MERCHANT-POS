import { acquirerConfig } from '../../../config/acquirer';
import { HttpAcquirerClient } from './http-acquirer.client';
import { VaultBankAcquirerClient } from './vault-bank-acquirer.client';
import { AcquirerAuthRequest, AcquirerAuthResponse, AcquirerCaptureRequest, AcquirerCaptureResponse } from './acquirer.types';

export interface AcquirerClient {
  authorize(request: AcquirerAuthRequest): Promise<AcquirerAuthResponse>;
  capture(request: AcquirerCaptureRequest): Promise<AcquirerCaptureResponse>;
}

function isTcpHost(host: string): boolean {
  // bare IP or hostname with no http/https prefix = TCP socket
  // empty host also routes to vault bank (127.0.0.1:9000 default)
  if (!host) return true;
  return !host.startsWith('http://') && !host.startsWith('https://');
}

export function createAcquirerClient(): AcquirerClient {
  const host = acquirerConfig.host || '';
  const protocol = (acquirerConfig.protocol || 'http-json').toLowerCase();

  // Use vault bank TCP client when:
  //  - protocol is iso8583-tcp, OR
  //  - host is a bare IP/hostname (not http/https)
  if (protocol === 'iso8583-tcp' || isTcpHost(host)) {
    return new VaultBankAcquirerClient();
  }
  return new HttpAcquirerClient();
}