import { HttpAcquirerClient } from './http-acquirer.client';
import { PspAcquirerClient } from './psp-acquirer.client';
import { VaultBankAcquirerClient } from './vault-bank-acquirer.client';
import { Iso8583AcquirerClient } from './iso8583-acquirer.client';
import { acquirerConfig } from '../../../config/acquirer';
import { CardNetwork } from './schemeNetwork';
import { SchemeRoute, resolveRoute } from './schemeRouting';
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

/** Base URL for an HTTP sponsor endpoint (bare hosts default to https). */
function httpBaseUrl(route: SchemeRoute): string | undefined {
  if (!route.host) return undefined;
  if (route.dedicated && !/^https?:\/\//i.test(route.host)) {
    return `https://${route.host}${route.port ? `:${route.port}` : ''}`;
  }
  return route.host;
}

/**
 * Build the acquirer client for a card network.
 *
 * Called with no network, the historical default connection (`ACQUIRER_*`) is
 * used, unchanged. Called with a network, the sponsor route for that network is
 * resolved by `schemeRouting.ts`: the network's own `SCHEME_<NET>_*` endpoint,
 * the endpoint of the network it is processed over, or the default connection
 * when neither is configured.
 *
 * A dedicated endpoint configured as `iso8583-tcp` is served by the real binary
 * ISO 8583 client over the persistent scheme link. The default/fallback
 * connection keeps the local vault-bank pipe protocol.
 */
export function createAcquirerClient(network?: CardNetwork): AcquirerClient {
  // A configured PSP outranks every scheme route: it is the only transport that
  // actually collects real funds, so nothing may fall back past it.
  if (acquirerConfig.pspBaseUrl) {
    return new PspAcquirerClient();
  }

  const route = resolveRoute(network ?? 'OTHER');

  if (!route.dedicated) {
    const host = route.host || '';
    const protocol = (route.protocol || 'http-json').toLowerCase();

    // Use vault bank TCP client when:
    //  - protocol is iso8583-tcp, OR
    //  - host is a bare IP/hostname (not http/https)
    if (protocol === 'iso8583-tcp' || isTcpHost(host)) {
      return new VaultBankAcquirerClient();
    }
    return new HttpAcquirerClient();
  }

  if (route.protocol === 'http-json') {
    return new HttpAcquirerClient({ baseUrl: httpBaseUrl(route) });
  }

  // Dedicated sponsor endpoint speaking ISO 8583 over the persistent link.
  return new Iso8583AcquirerClient({
    host: route.host,
    port: route.port,
    timeoutMs: route.timeoutMs,
    header: route.header,
    key: route.network,
    macField: route.macField,
  });
}
