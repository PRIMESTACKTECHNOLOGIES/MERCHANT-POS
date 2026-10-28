/**
 * Acquirer shim — delegates to the scheme-routing acquirer module.
 *
 * This file shares its name with the `acquirer/` directory, so TypeScript
 * resolves `./acquirer` to this file rather than `acquirer/index.ts`. It must
 * therefore re-export the real factory, otherwise callers that need scheme
 * routing (realSettlement.service.ts, vaultCardNetwork.ts) would silently get
 * a client factory that ignores the card network.
 */
export * from './acquirer/index';
