import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './ui/Modal';
import {
  transakCreateWidgetSession,
  transakGetConfig,
  transakGetCountries,
  type TransakConfigResponse,
  type TransakWidgetSessionParams,
  type TransakCountry,
  type TransakCountriesResponse,
} from '../lib/api';
import { Transak, type TransakConfig } from '@transak/ui-js-sdk';

export type TransakFlow = 'BUY' | 'SELL' | 'BUY,SELL';

export interface TransakWidgetModalProps {
  open: boolean;
  onClose: () => void;
  flow?: TransakFlow;
  defaultCryptoCurrency?: string;
  defaultNetwork?: string;
  defaultFiatAmount?: number;
  defaultFiatCurrency?: string;
  customerId?: string;
  walletCode?: string;
  partnerCustomerId?: string;
  walletAddress?: string;
  redirectURL?: string;
  partnerMetaData?: Record<string, any> | string;
  onOrderCreated?: (order: any) => void;
  onOrderSuccessful?: (order: any) => void;
  onOrderFailed?: (order: any) => void;
  onOrderCancelled?: (order: any) => void;
  onWidgetClose?: () => void;
  onWidgetOpen?: () => void;
  size?: 'lg' | 'xl';
  title?: string;
}

type TransakSdkEventName =
  | typeof Transak.EVENTS.TRANSAK_WIDGET_INITIALISED
  | typeof Transak.EVENTS.TRANSAK_ORDER_CREATED
  | typeof Transak.EVENTS.TRANSAK_ORDER_SUCCESSFUL
  | typeof Transak.EVENTS.TRANSAK_ORDER_CANCELLED
  | typeof Transak.EVENTS.TRANSAK_ORDER_FAILED
  | typeof Transak.EVENTS.TRANSAK_WIDGET_CLOSE_REQUEST
  | typeof Transak.EVENTS.TRANSAK_WALLET_REDIRECTION
  | typeof Transak.EVENTS.TRANSAK_WIDGET_CLOSE;

export const TransakWidgetModal: React.FC<TransakWidgetModalProps> = ({
  open,
  onClose,
  flow = 'BUY',
  defaultCryptoCurrency = 'USDT',
  defaultNetwork,
  defaultFiatAmount,
  defaultFiatCurrency = 'USD',
  customerId,
  walletCode,
  partnerCustomerId,
  walletAddress,
  redirectURL,
  partnerMetaData,
  onOrderCreated,
  onOrderSuccessful,
  onOrderFailed,
  onOrderCancelled,
  onWidgetOpen,
  onWidgetClose,
  size = 'xl',
  title,
}) => {
  const sdkRef = useRef<Transak | null>(null);
  const unsubscribesRef = useRef<Array<() => void>>([]);
  const [cfg, setCfg] = useState<TransakConfigResponse | null>(null);
  const [loadingCfg, setLoadingCfg] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<{
    widgetUrl: string;
    sessionId: string;
    expiresAt: string;
  } | null>(null);
  const [stage, setStage] = useState<'loading' | 'ready' | 'sdk_error' | 'config_error'>('loading');
  const [retryNonce, setRetryNonce] = useState(0);
  const [widgetStatus, setWidgetStatus] = useState<TransakSdkEventName | string>('Loading widget...');
  const [lastOrder, setLastOrder] = useState<any>(null);

  const [countriesResponse, setCountriesResponse] = useState<TransakCountriesResponse | null>(null);
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [countriesErr, setCountriesErr] = useState<string | null>(null);
  const [countryQuery, setCountryQuery] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<TransakCountry | null>(null);

  const allowedCountries = useMemo<TransakCountry[]>(
    () => countriesResponse?.response?.filter(c => c?.isAllowed) || [],
    [countriesResponse]
  );
  const filteredCountries = useMemo<TransakCountry[]>(() => {
    const q = countryQuery.trim().toLowerCase();
    const list = allowedCountries;
    if (!q) return list;
    return list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.alpha2 || '').toLowerCase() === q ||
      (c.alpha3 || '').toLowerCase() === q ||
      (c.currencyCode || '').toLowerCase() === q
    );
  }, [allowedCountries, countryQuery]);
  const uniqueFiatCurrencies = useMemo(() => {
    const set = new Set<string>();
    allowedCountries.forEach(c => { if (c?.currencyCode) set.add(c.currencyCode); });
    return Array.from(set).sort();
  }, [allowedCountries]);
  const partnerCardCount = useMemo<number>(() => {
    const set = new Set<string>();
    allowedCountries.forEach(c => {
      c.partners?.forEach(p => { if (p?.isCardPayment && p?.currencyCode) set.add(p.currencyCode); });
    });
    return set.size;
  }, [allowedCountries]);

  const sessionKey = useMemo(
    () => `${open}-${flow}-${defaultCryptoCurrency}-${defaultFiatAmount}-${walletCode || customerId || partnerCustomerId}-${selectedCountry?.alpha2 || ''}-${retryNonce}`,
    [open, flow, defaultCryptoCurrency, defaultFiatAmount, walletCode, customerId, partnerCustomerId, selectedCountry, retryNonce]
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setLoadingCfg(true);
    setSessionInfo(null);
    setLastOrder(null);
    transakGetConfig()
      .then((c) => {
        if (cancelled) return;
        setCfg(c);
        setLoadingCfg(false);
        if (!c.configured) {
          setStage('config_error');
          setError('Transak is not configured on the server. Ask admin to set TRANSAK_API_KEY + TRANSAK_API_SECRET.');
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadingCfg(false);
        setStage('config_error');
        setError(e.message || 'Failed to load Transak config');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCountriesLoading(true);
    setCountriesErr(null);
    transakGetCountries()
      .then((r) => {
        if (cancelled) return;
        setCountriesResponse(r);
        if (r && !r.ok) setCountriesErr(r.error || 'Could not load country list');
      })
      .catch((e) => {
        if (cancelled) return;
        setCountriesErr(e.message || 'Countries load failed');
      })
      .finally(() => {
        if (!cancelled) setCountriesLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || !cfg || !cfg.configured) return;
    let cancelled = false;
    setStage('loading');
    setWidgetStatus('Creating secure widget session...');
    const params: TransakWidgetSessionParams = {
      productsAvailed: flow,
      defaultCryptoCurrency,
      defaultFiatCurrency: selectedCountry?.currencyCode || defaultFiatCurrency,
      fiatCurrency: selectedCountry?.currencyCode || defaultFiatCurrency,
      ...(defaultFiatAmount ? { defaultFiatAmount } : {}),
      ...(defaultNetwork ? { defaultNetwork } : {}),
      ...(customerId ? { customerId } : {}),
      ...(walletCode ? { walletCode } : {}),
      ...(partnerCustomerId ? { partnerCustomerId } : {}),
      ...(walletAddress ? { walletAddress } : {}),
      ...(redirectURL ? { redirectURL } : {}),
      ...(partnerMetaData ? { partnerMetaData } : {}),
    };
    transakCreateWidgetSession(params)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setStage('sdk_error');
          setError('Backend did not return a valid Transak widget session.');
          return;
        }
        setSessionInfo({ widgetUrl: r.widgetUrl, sessionId: r.sessionId || '', expiresAt: r.expiresAt });
        setWidgetStatus('Initialising widget...');
        initSdk(r.widgetUrl);
      })
      .catch((e) => {
        if (cancelled) return;
        setStage('sdk_error');
        setError(e.message || 'Widget session creation failed');
      });
    return () => {
      cancelled = true;
      cleanUpListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, cfg?.configured]);

  function cleanUpListeners() {
    while (unsubscribesRef.current.length) {
      try { unsubscribesRef.current.shift()?.(); } catch { /* ignore */ }
    }
    try {
      const instance = sdkRef.current;
      if (instance) {
        try { instance.cleanup?.(); } catch { /* ignore */ }
        try { instance.close?.(); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    sdkRef.current = null;
  }

  const TRANSAK_MOUNT_CONTAINER_ID = 'transak-sdk-mount';

  function initSdk(widgetUrl: string) {
    Promise.resolve()
      .then(async () => {
        const TransakClass: typeof Transak = Transak;
        if (!TransakClass || typeof TransakClass !== 'function') {
          setStage('sdk_error');
          setError('@transak/ui-js-sdk did not export Transak constructor');
          return;
        }

        try {
          const sdkConfig: TransakConfig = {
            widgetUrl,
            containerId: TRANSAK_MOUNT_CONTAINER_ID,
            widgetWidth: '100%',
            widgetHeight: '100%',
          };

          const instance = new TransakClass(sdkConfig);
          sdkRef.current = instance;

          try {
            TransakClass.on?.('*', (data: any) => {
              const eventName =
                (data && (data.eventName || data.name)) ||
                (typeof data === 'string' ? data : '');
              if (eventName) setWidgetStatus(String(eventName));
            });
          } catch { /* ignore */ }

          type Handler = (data: any) => void;
          const addListener = (evt: TransakSdkEventName, handler: Handler) => {
            try {
              if (typeof TransakClass.on === 'function') {
                TransakClass.on(evt, handler);
                unsubscribesRef.current.push(() => {
                  try {
                    if (typeof (TransakClass as any).off === 'function') {
                      (TransakClass as any).off(evt, handler);
                    }
                  } catch { /* ignore */ }
                });
              }
            } catch { /* ignore */ }
          };

          addListener(Transak.EVENTS.TRANSAK_WIDGET_INITIALISED, (d: any) => {
            setStage('ready');
            setWidgetStatus(Transak.EVENTS.TRANSAK_WIDGET_INITIALISED);
            onWidgetOpen?.();
            const order = d?.data || d;
            if (order && order.id) {
              // no-op; init event carries widget params only
            }
          });

          addListener(Transak.EVENTS.TRANSAK_ORDER_CREATED, (d: any) => {
            const order = d?.data || d;
            setLastOrder(order);
            setWidgetStatus('Order created');
            onOrderCreated?.(order);
          });

          addListener(Transak.EVENTS.TRANSAK_ORDER_SUCCESSFUL, (d: any) => {
            const order = d?.data || d;
            setLastOrder(order);
            setWidgetStatus('Order successful');
            onOrderSuccessful?.(order);
            try { instance.close?.(); } catch { /* ignore */ }
          });

          addListener(Transak.EVENTS.TRANSAK_ORDER_FAILED, (d: any) => {
            const order = d?.data || d;
            setLastOrder(order);
            setWidgetStatus('Order failed');
            onOrderFailed?.(order);
          });

          addListener(Transak.EVENTS.TRANSAK_ORDER_CANCELLED, (d: any) => {
            const order = d?.data || d;
            setLastOrder(order);
            setWidgetStatus('Order cancelled');
            onOrderCancelled?.(order);
          });

          addListener(Transak.EVENTS.TRANSAK_WIDGET_CLOSE_REQUEST, () => {
            setWidgetStatus(Transak.EVENTS.TRANSAK_WIDGET_CLOSE_REQUEST);
            // Let user dismiss; TRANSAK_WIDGET_CLOSE will run actual close() + onClose()
          });

          addListener(Transak.EVENTS.TRANSAK_WALLET_REDIRECTION, (d: any) => {
            const info = d?.data || d;
            setWidgetStatus('Wallet redirection: ' + (info?.wallet || info?.provider || ''));
          });

          addListener(Transak.EVENTS.TRANSAK_WIDGET_CLOSE, () => {
            setWidgetStatus('Widget closed');
            onWidgetClose?.();
            try { instance.close?.(); } catch { /* ignore */ }
            onClose();
          });

          try {
            instance.init();
          } catch (e: any) {
            setStage('sdk_error');
            setError(e?.message || 'Widget init() threw');
            return;
          }
        } catch (e: any) {
          setStage('sdk_error');
          setError(e?.message || 'Failed to initialise Transak SDK');
        }
      })
      .catch((e) => {
        setStage('sdk_error');
        setError('@transak/ui-js-sdk failed to load: ' + (e?.message || String(e)));
      });
  }

  useEffect(() => {
    return () => { cleanUpListeners(); };
  }, []);

  useEffect(() => {
    if (!open) cleanUpListeners();
  }, [open]);

  const modeBadge = cfg ? (
    <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
      cfg.mode === 'production' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
    }`}>
      {cfg.mode.toUpperCase()}
    </span>
  ) : null;

  const header = title ?? (
    <>Buy / Sell Crypto with Transak{modeBadge}</>
  );

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Transak"
      size={size}
    >
      <div className="flex flex-col" style={{ minHeight: 620 }}>
        <div className="flex items-center justify-between mb-3 gap-3">
          <h4 className="text-base font-semibold text-gray-900 truncate">{header}</h4>
          <span className="text-[11px] text-gray-500 whitespace-nowrap">
            {sessionInfo ? `Session exp ${new Date(sessionInfo.expiresAt).toLocaleTimeString()}` : ''}
          </span>
        </div>
        <div className="mb-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${
              stage === 'ready' ? 'bg-emerald-500' :
              stage === 'sdk_error' || stage === 'config_error' ? 'bg-red-500' : 'bg-amber-500 animate-pulse'
            }`} />
            <span className="font-mono uppercase tracking-wider text-[10px] text-gray-500">
              {widgetStatus || 'Idle'}
            </span>
          </div>
          {lastOrder && lastOrder.id && (
            <div className="mt-1 text-[11px] text-gray-700 break-all">
              Order: <span className="font-mono">{lastOrder.id}</span>
              {lastOrder.status && <span className="ml-2">· {String(lastOrder.status).toUpperCase()}</span>}
              {typeof lastOrder.fiatAmount === 'number' && (
                <span className="ml-2">${lastOrder.fiatAmount.toFixed(2)} {lastOrder.fiatCurrency || 'USD'}</span>
              )}
            </div>
          )}
        </div>

        <div className="mb-3 rounded-lg border border-gray-200 bg-white p-3 text-xs">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <span className="font-semibold text-gray-800">
                Supported Countries <span className="text-gray-400 font-normal">· KYC & Docs</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[10px] font-bold">
                {countriesLoading ? '…' : `${allowedCountries.length} allowed`}
              </span>
              {!countriesLoading && partnerCardCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 px-2 py-0.5 text-[10px] font-bold">
                  {partnerCardCount} card currencies
                </span>
              )}
              {!countriesLoading && uniqueFiatCurrencies.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[10px] font-bold">
                  {uniqueFiatCurrencies.length} fiats
                </span>
              )}
              {countriesResponse?.mode && (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${countriesResponse.mode === 'production' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                  mode: {countriesResponse.mode}
                </span>
              )}
            </div>
            <input
              type="text"
              value={countryQuery}
              onChange={(e) => setCountryQuery(e.target.value)}
              placeholder="Search country / code / currency"
              className="w-56 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {countriesErr && (
            <div className="rounded-md bg-red-50 border border-red-100 text-red-700 px-2 py-1 mb-2 text-[11px]">
              {countriesErr}
            </div>
          )}

          <div className="mb-2 text-[11px] text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Selected:{' '}
              {selectedCountry ? (
                <span className="font-bold text-gray-900">
                  {selectedCountry.name} ({selectedCountry.alpha2}) · fiat{' '}
                  <span className="inline-block bg-gray-100 rounded px-1 text-gray-800 font-mono">
                    {selectedCountry.currencyCode}
                  </span>
                  {selectedCountry.isLightKycAllowed ? (
                    <span className="ml-2 inline-block rounded-full bg-emerald-50 text-emerald-700 px-1.5 font-bold text-[10px]">light KYC</span>
                  ) : (
                    <span className="ml-2 inline-block rounded-full bg-slate-100 text-slate-600 px-1.5 font-bold text-[10px]">full KYC</span>
                  )}
                </span>
              ) : (
                <span className="text-gray-500">
                  none (using default <code className="bg-gray-100 px-1 rounded">{defaultFiatCurrency}</code>)
                </span>
              )}
            </span>
            {selectedCountry && (
              <button
                onClick={() => setSelectedCountry(null)}
                className="text-indigo-600 hover:text-indigo-800 font-bold"
              >
                Clear selection
              </button>
            )}
            {!countriesLoading && selectedCountry?.currencyCode && (
              <span className="text-emerald-700 font-bold">
                → widget will preset fiat = {selectedCountry.currencyCode}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
            {countriesLoading && (
              <div className="col-span-2 text-center text-gray-500 py-4 text-[11px]">Loading country list…</div>
            )}
            {!countriesLoading && filteredCountries.length === 0 && (
              <div className="col-span-2 text-center text-gray-500 py-3 text-[11px]">No countries match your search.</div>
            )}
            {!countriesLoading && filteredCountries.map((c) => {
              const isSel = selectedCountry?.alpha2 === c.alpha2;
              return (
                <button
                  key={c.alpha2}
                  onClick={() => setSelectedCountry(isSel ? null : c)}
                  className={`text-left rounded-md border px-2 py-2 transition ${isSel ? 'border-indigo-500 bg-indigo-50 shadow-sm ring-1 ring-indigo-300' : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold text-gray-900 truncate">
                      {c.alpha2} · {c.name}
                    </span>
                    <span className="text-[10px] font-mono bg-gray-100 rounded px-1 text-gray-700 whitespace-nowrap">
                      {c.currencyCode}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-gray-600">
                    {c.isLightKycAllowed ? (
                      <span className="rounded-full bg-emerald-50 text-emerald-700 px-1.5 py-0.5 font-bold">light KYC</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 text-slate-600 px-1.5 py-0.5 font-bold">full KYC</span>
                    )}
                    {c.supportedDocuments?.length ? (
                      <span className="text-gray-500">
                        docs: {c.supportedDocuments.map((d: string) => (
                          <code key={d} className="bg-gray-100 rounded px-1 mx-0.5 text-gray-700">{d.replace(/_/g, ' ')}</code>
                        ))}
                      </span>
                    ) : null}
                    {c.partners?.some(p => p.isCardPayment) && (
                      <span className="rounded-full bg-sky-50 text-sky-700 px-1.5 py-0.5 font-bold">card ✓</span>
                    )}
                    {c.states?.length ? (
                      <span className="rounded-full bg-amber-50 text-amber-700 px-1.5 py-0.5 font-bold">
                        {c.states.filter(s => s.isAllowed).length}/{c.states.length} states
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {loadingCfg && (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Loading Transak configuration...
          </div>
        )}

        {!loadingCfg && (stage === 'config_error' || stage === 'sdk_error') && (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
            <div className="h-12 w-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {stage === 'config_error' ? 'Transak Not Configured' : 'Transak SDK Error'}
            </div>
            <div className="text-xs text-red-600 max-w-md break-words">
              {error || 'Unknown error'}
            </div>
            {stage === 'sdk_error' && (
              <button
                type="button"
                onClick={() => { cleanUpListeners(); setError(null); setSessionInfo(null); setStage('loading'); setRetryNonce(n => n + 1); }}
                className="mt-1 inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Retry with a fresh session
              </button>
            )}
            {sessionInfo && (
              <a
                href={sessionInfo.widgetUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Open in browser instead →
              </a>
            )}
          </div>
        )}

        {!loadingCfg && stage !== 'config_error' && stage !== 'sdk_error' && !sessionInfo && (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
            Creating secure widget session...
          </div>
        )}

        {!loadingCfg && stage !== 'config_error' && stage !== 'sdk_error' && sessionInfo && (
          <div className="flex-1 relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50" id="transak-sdk-mount">
            {stage !== 'ready' && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm bg-gray-50/80 z-10 pointer-events-none">
                <div className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Loading Transak widget...
                </div>
              </div>
            )}
          </div>
        )}

        {sessionInfo && stage !== 'config_error' && (
          <details className="mt-3 text-[11px] text-gray-500">
            <summary className="cursor-pointer hover:text-gray-700">Debug</summary>
            <div className="mt-2 space-y-1">
              <div><span className="font-semibold">Mode:</span> {cfg?.mode || '—'}</div>
              <div><span className="font-semibold">Flow:</span> {flow}</div>
              <div><span className="font-semibold">Asset:</span> {defaultCryptoCurrency}{defaultNetwork ? ` · ${defaultNetwork}` : ''}</div>
              {defaultFiatAmount ? <div><span className="font-semibold">Preset:</span> ${defaultFiatAmount} {defaultFiatCurrency}</div> : null}
              <div className="break-all"><span className="font-semibold">Widget URL:</span> <a href={sessionInfo.widgetUrl} target="_blank" rel="noreferrer noopener" className="text-indigo-600 hover:underline">{sessionInfo.widgetUrl}</a></div>
            </div>
          </details>
        )}
      </div>
    </Modal>
  );
};

export default TransakWidgetModal;
