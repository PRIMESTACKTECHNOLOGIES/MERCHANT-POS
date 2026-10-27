/**
 * Acquirer shim — re-exports HttpAcquirerClient as createAcquirerClient()
 * so the existing payments.service.ts import works without modification.
 */
import { HttpAcquirerClient } from '../../services/acquirer/HttpAcquirerClient';

export { HttpAcquirerClient };

export function createAcquirerClient(): HttpAcquirerClient {
  return new HttpAcquirerClient();
}
