/**
 * Acquirer barrel — re-exports createAcquirerClient from the correct
 * protocol-aware implementation so payments.service.ts import works.
 */
export { createAcquirerClient } from './acquirer/index';
export type { AcquirerClient } from './acquirer/index';
export {
  detectNetworkFromPan,
  detectNetworkFromTrack2,
  resolveCardNetwork,
  networkLabel,
} from './acquirer/schemeNetwork';
export type { CardNetwork, NetworkResolution } from './acquirer/schemeNetwork';
export { resolveRoute, listRoutes, describeRouting } from './acquirer/schemeRouting';
export type { SchemeRoute, SchemeRoutingSummary } from './acquirer/schemeRouting';
