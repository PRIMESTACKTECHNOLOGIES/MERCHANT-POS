/**
 * Scheme (card-network) sponsor routing.
 *
 * Answers one question for every charge: "which endpoint should this card's
 * authorization be sent to?"
 *
 * Each network can be given its own endpoint through `SCHEME_<NETWORK>_*`
 * environment variables. A network without its own endpoint falls back to the
 * default acquirer connection (`ACQUIRER_HOST` / `ACQUIRER_PORT` /
 * `ACQUIRER_PROTOCOL`), which is how the processor behaves today.
 *
 * HONESTY NOTE — read before configuring:
 * Visa, Mastercard, American Express and UnionPay are closed, membership-based
 * networks. Configuring a host here does NOT grant access to them. The host
 * must be an endpoint operated by a licensed acquirer or processor that you are
 * sponsored through (for example your acquirer bank). Pointing a scheme at a
 * public address will simply fail to authorize.
 *
 * Environment variables, per network (replace <NET> with VISA, MASTERCARD,
 * AMEX, UNIONPAY, JCB, DISCOVER or DINERS):
 *
 *   SCHEME_<NET>_HOST          endpoint host/IP, or https:// URL   (enables route)
 *   SCHEME_<NET>_PORT          endpoint port (default 8583 tcp / 443 http)
 *   SCHEME_<NET>_PROTOCOL      iso8583-tcp | http-json
 *   SCHEME_<NET>_HEADER        LEN2 | LEN4 | TPDU | NONE
 *   SCHEME_<NET>_TIMEOUT_MS    request timeout
 *   SCHEME_<NET>_ICA           sponsor ICA / acquiring institution id (DE32)
 *   SCHEME_<NET>_MID           acquirer merchant id used as DE42 for this network
 *   SCHEME_<NET>_ACQ_INST_ID   acquiring institution identification code (DE32)
 *   SCHEME_<NET>_MAC_FIELD     64 or 128
 *   SCHEME_<NET>_MAC_ALGORITHM MAC algorithm name (see iso8583.security.ts)
 *   SCHEME_<NET>_ENABLED       "false" to skip this network's dedicated route
 *   SCHEME_<NET>_NOTE          free-text operator note surfaced in diagnostics
 *
 * Global:
 *   SCHEME_ROUTING             "off" disables per-network routing entirely
 */

import { acquirerConfig } from '../../../config/acquirer';
import { CardNetwork, CARD_NETWORKS, networkLabel } from './schemeNetwork';

export type SchemeProtocol = 'iso8583-tcp' | 'http-json';
export type SchemeHeaderMode = 'LEN2' | 'LEN4' | 'TPDU' | 'NONE';

const HEADER_MODES: ReadonlyArray<SchemeHeaderMode> = ['LEN2', 'LEN4', 'TPDU', 'NONE'];

export interface SchemeRoute {
  network: CardNetwork;
  label: string;
  /** True when this network has its own SCHEME_<NET>_* endpoint configured. */
  dedicated: boolean;
  host: string;
  port?: number;
  protocol: SchemeProtocol;
  header: SchemeHeaderMode;
  timeoutMs: number;
  /** Sponsor ICA / acquiring institution identification (DE32). */
  sponsorIca?: string;
  /** Acquirer merchant id used as DE42 for this network (overrides the default). */
  merchantId?: string;
  /** Acquiring institution identification code (DE32). */
  acquiringInstitutionId?: string;
  /** MAC data element: 64 (primary) or 128 (secondary). */
  macField: number;
  macAlgorithm?: string;
  note?: string;
}

/**
 * Networks that are processed over another network's rails. Consulted when a
 * network has no dedicated endpoint of its own, before falling back to the
 * default acquirer.
 */
const NETWORK_ROUTE_ALIAS: Partial<Record<CardNetwork, CardNetwork>> = {
  DINERS: 'DISCOVER',
};

function envFor(network: CardNetwork, suffix: string): string | undefined {
  const value = process.env[`SCHEME_${network}_${suffix}`];
  return value && value.trim() ? value.trim() : undefined;
}

function defaultHeaderMode(): SchemeHeaderMode {
  const raw = (process.env.ISO8583_HEADER || 'NONE').trim().toUpperCase() as SchemeHeaderMode;
  return HEADER_MODES.includes(raw) ? raw : 'NONE';
}

function headerModeFor(network: CardNetwork): SchemeHeaderMode {
  const raw = (envFor(network, 'HEADER') || '').toUpperCase() as SchemeHeaderMode;
  return HEADER_MODES.includes(raw) ? raw : defaultHeaderMode();
}

function numberFor(network: CardNetwork, suffix: string, fallback: number): number {
  const raw = envFor(network, suffix);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Build the dedicated route for a network, or null when it is not configured. */
function readDedicatedRoute(network: CardNetwork): SchemeRoute | null {
  if (envFor(network, 'ENABLED')?.toLowerCase() === 'false') return null;

  const rawHost = envFor(network, 'HOST');
  if (!rawHost) return null;

  const host = rawHost.replace(/^(tcp|tls):\/\//, '');
  const protocol = (envFor(network, 'PROTOCOL')
    || (host.startsWith('http://') || host.startsWith('https://') ? 'http-json' : 'iso8583-tcp')) as SchemeProtocol;

  return {
    network,
    label: networkLabel(network),
    dedicated: true,
    host,
    port: numberFor(network, 'PORT', protocol === 'http-json' ? 443 : 8583),
    protocol,
    header: headerModeFor(network),
    timeoutMs: numberFor(network, 'TIMEOUT_MS', acquirerConfig.timeoutMs || 8000),
    sponsorIca: envFor(network, 'ICA'),
    merchantId: envFor(network, 'MID'),
    acquiringInstitutionId: envFor(network, 'ACQ_INST_ID'),
    macField: numberFor(network, 'MAC_FIELD', 64),
    macAlgorithm: envFor(network, 'MAC_ALGORITHM'),
    note: envFor(network, 'NOTE'),
  };
}

/** The route used when a network has no dedicated endpoint: the default acquirer. */
function readDefaultRoute(network: CardNetwork): SchemeRoute {
  return {
    network,
    label: networkLabel(network),
    dedicated: false,
    host: acquirerConfig.host || '',
    port: acquirerConfig.port,
    protocol: (acquirerConfig.protocol || 'http-json') as SchemeProtocol,
    header: defaultHeaderMode(),
    timeoutMs: acquirerConfig.timeoutMs || 8000,
    sponsorIca: process.env.PROCESSOR_SPONSOR_ICA?.trim() || undefined,
    merchantId: acquirerConfig.merchantId,
    acquiringInstitutionId: envFor(network, 'ACQ_INST_ID'),
    macField: acquirerConfig.macField || 64,
    macAlgorithm: acquirerConfig.macAlgorithm,
    note: 'Default acquirer (sponsor) connection — no dedicated endpoint for this network',
  };
}

export function isSchemeRoutingEnabled(): boolean {
  return (process.env.SCHEME_ROUTING || 'on').trim().toLowerCase() !== 'off';
}

/**
 * Resolve the endpoint that should serve a network:
 *   1. the network's own dedicated route, if configured;
 *   2. the route of the network it is processed over (see NETWORK_ROUTE_ALIAS);
 *   3. the default acquirer connection.
 */
export function resolveRoute(network: CardNetwork): SchemeRoute {
  if (isSchemeRoutingEnabled()) {
    const dedicated = readDedicatedRoute(network);
    if (dedicated) return dedicated;

    const alias = NETWORK_ROUTE_ALIAS[network];
    if (alias) {
      const aliased = readDedicatedRoute(alias);
      if (aliased) {
        return {
          ...aliased,
          network,
          label: networkLabel(network),
          note: `Routed over the ${networkLabel(alias)} sponsor endpoint`,
        };
      }
    }
  }
  return readDefaultRoute(network);
}

/** Resolve a route for every known network — used by diagnostics. */
export function listRoutes(): SchemeRoute[] {
  return CARD_NETWORKS.map((network) => resolveRoute(network));
}

export interface SchemeRoutingSummary {
  enabled: boolean;
  fallbackHost: string;
  dedicatedCount: number;
  routes: Array<{
    network: CardNetwork;
    label: string;
    dedicated: boolean;
    endpoint: string;
    protocol: SchemeProtocol;
    header: SchemeHeaderMode;
    macField: number;
    sponsorIca: string | null;
    note: string | null;
  }>;
}

export function describeRouting(): SchemeRoutingSummary {
  const routes = listRoutes();
  return {
    enabled: isSchemeRoutingEnabled(),
    fallbackHost: acquirerConfig.host || '(unset)',
    dedicatedCount: routes.filter((route) => route.dedicated).length,
    routes: routes.map((route) => ({
      network: route.network,
      label: route.label,
      dedicated: route.dedicated,
      endpoint: route.host ? `${route.host}${route.port ? `:${route.port}` : ''}` : '(unset)',
      protocol: route.protocol,
      header: route.header,
      macField: route.macField,
      sponsorIca: route.sponsorIca || null,
      note: route.note || null,
    })),
  };
}
