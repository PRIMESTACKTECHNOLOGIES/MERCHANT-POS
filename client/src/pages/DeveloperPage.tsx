import { useState, useEffect } from "react";
import { regenerateApiKey, getProfile } from "../lib/api";
import { useToast } from "../components/ui/toastContext";
import { resolveApiBaseUrl } from "../lib/backendUrl";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created: string;
  lastUsed: string | null;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  environment: 'PRODUCTION' | 'TEST';
}

const StatusBadge = ({ status }: { status: string }) => {
  const styles: Record<string, string> = {
    ACTIVE: "bg-green-50 text-green-700 border-green-100",
    REVOKED: "bg-gray-50 text-gray-500 border-gray-100",
    EXPIRED: "bg-red-50 text-red-700 border-red-100",
  };

  const dotColors: Record<string, string> = {
    ACTIVE: "bg-green-500",
    REVOKED: "bg-gray-400",
    EXPIRED: "bg-red-500",
  };

  const s = status?.toUpperCase() || 'ACTIVE';

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${styles[s] || styles.ACTIVE}`}>
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dotColors[s] || dotColors.ACTIVE}`}></span>
      {status}
    </span>
  );
};

export const DeveloperPage = () => {
  const { showToast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState<string | null>(null);

  // ── Settlement Instructions ────────────────────────────────────────────────
  const [settlementInstructions, setSettlementInstructions] = useState<any[]>([]);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementTotal, setSettlementTotal] = useState(0);
  const [settlementFetched, setSettlementFetched] = useState(false);

  // ── Wise Integration ───────────────────────────────────────────────────────
  const [wiseStatus, setWiseStatus] = useState<any>(null);
  const [wiseLoading, setWiseLoading] = useState(false);
  const [wiseWebhookEvents, setWiseWebhookEvents] = useState<any[]>([]);
  const [wiseEventsFetched, setWiseEventsFetched] = useState(false);
  const [wiseSyncing, setWiseSyncing] = useState(false);
  const [wiseSyncResult, setWiseSyncResult] = useState<any>(null);
  const [wiseCollecting, setWiseCollecting] = useState(false);
  const [wiseCollectResult, setWiseCollectResult] = useState<any>(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [collectCurrency, setCollectCurrency] = useState('USD');

  // ── Card Authorization Manager ────────────────────────────────────────────
  const [cardAuthList,    setCardAuthList]    = useState<any[]>([]);
  const [cardAuthLoading, setCardAuthLoading] = useState(false);
  const [cardAuthFetched, setCardAuthFetched] = useState(false);
  const [caProtocol,      setCaProtocol]      = useState<'101.1'|'101.6'|'201.3'>('201.3');
  const [caPan,           setCaPan]           = useState('4451470024994643');
  const [caCode,          setCaCode]          = useState('');
  const [caCvv,           setCaCvv]           = useState('');
  const [caAmount,        setCaAmount]        = useState('');
  const [caCreating,      setCaCreating]      = useState(false);
  const [caValidating,    setCaValidating]    = useState(false);
  const [caValidateCode,  setCaValidateCode]  = useState('');
  const [caValidateResult,setCaValidateResult]= useState<any>(null);
  const [caDeletingId,    setCaDeletingId]    = useState<string | null>(null);

  // ── Webhook / API integration validation ───────────────────────────────────
  const [integrationApiKey, setIntegrationApiKey] = useState('');
  const [integrationApiSecret, setIntegrationApiSecret] = useState('');
  const [integrationEndpointUrl, setIntegrationEndpointUrl] = useState('');
  const [integrationValidation, setIntegrationValidation] = useState<{ verified: boolean; reachable?: boolean; credentialsConfirmed?: boolean; httpStatus?: number; reason: string } | null>(null);
  const [integrationValidating, setIntegrationValidating] = useState(false);

  const runWiseCollect = async () => {
    const amt = parseFloat(collectAmount);
    if (!amt || amt <= 0) { showToast('Enter a valid amount', 'error'); return; }
    setWiseCollecting(true);
    setWiseCollectResult(null);
    try {
      const res = await fetch(`${BASE_URL}/api/payout/wise/collect-and-send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          currency: collectCurrency,
          targetBic: '',
          targetAccount: '',
          targetName: 'JUKRUTI LOGISTICS PTY LTD',
          targetAddressLines: ['9 HOUTKAPPER STR', 'OLIFANTSHOEK 8450', 'SOUTH AFRICA'],
          reference: `POS-COLLECT-${Date.now().toString(36).toUpperCase()}`,
          merchantId: 'MRC-1001',
        }),
      });
      const data = await res.json();
      setWiseCollectResult(data);
      if (data.success) {
        showToast(`✅ Wise transfer created — ID: ${data.transferId}`, 'success');
        await fetchWiseStatus();
      } else {
        showToast(data.message || 'Transfer failed', 'error');
      }
    } catch (e: any) {
      showToast(`Error: ${e.message}`, 'error');
    } finally {
      setWiseCollecting(false);
    }
  };

  // ── MT103 SWIFT Wire ───────────────────────────────────────────────────────
  const [mt103List, setMt103List] = useState<any[]>([]);
  const [mt103Loading, setMt103Loading] = useState(false);
  const [mt103Generating, setMt103Generating] = useState(false);
  const [mt103Fetched, setMt103Fetched] = useState(false);
  const [mt103Amount, setMt103Amount] = useState('');
  const [mt103Currency, setMt103Currency] = useState('USD');
  const [mt103RemInfo, setMt103RemInfo] = useState('');
  const [mt103Preview, setMt103Preview] = useState<any>(null);

  const fetchMt103List = async () => {
    setMt103Loading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/payout/mt103/MRC-1001`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setMt103List(data.mt103s || []);
      setMt103Fetched(true);
    } catch (e: any) {
      showToast(`MT103 fetch failed: ${e.message}`, 'error');
    } finally {
      setMt103Loading(false);
    }
  };

  const generateMt103 = async () => {
    if (!mt103Amount || parseFloat(mt103Amount) <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }
    setMt103Generating(true);
    try {
      const res = await fetch(`${BASE_URL}/api/payout/mt103/generate-from-balance`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: 'MRC-1001',
          currency: mt103Currency,
          amount: parseFloat(mt103Amount),
          remittanceInfo: mt103RemInfo || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setMt103Preview(data);
        showToast(`✅ MT103 generated — UETR: ${data.uetr?.slice(0, 8)}...`, 'success');
        await fetchMt103List();
        setMt103Amount('');
      } else {
        showToast(data.error || 'Generation failed', 'error');
      }
    } catch (e: any) {
      showToast(`MT103 generation failed: ${e.message}`, 'error');
    } finally {
      setMt103Generating(false);
    }
  };

  const downloadMt103 = (id: string, ref: string, valueDate: string) => {
    const url = `${BASE_URL}/api/payout/mt103/download/${id}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `MT103-${ref}-${valueDate}.txt`;
    // Need auth header — open in new tab with token in URL won't work
    // Instead fetch and create blob
    fetch(url, { headers: { Authorization: `Bearer ${token()}` } })
      .then(r => r.text())
      .then(text => {
        const blob = new Blob([text], { type: 'text/plain' });
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `MT103-${ref}-${valueDate}.txt`;
        link.click();
        URL.revokeObjectURL(blobUrl);
        showToast('MT103 downloaded', 'success');
      })
      .catch(() => showToast('Download failed', 'error'));
  };

  const markMt103Sent = async (id: string) => {
    try {
      const res = await fetch(`${BASE_URL}/api/payout/mt103/${id}/mark-sent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.ok) {
        showToast('MT103 marked as SENT', 'success');
        await fetchMt103List();
      }
    } catch { showToast('Failed to update status', 'error'); }
  };

  const BASE_URL = resolveApiBaseUrl({ envValue: import.meta.env.VITE_API_URL, currentOrigin: window.location.origin });
  const token = () => localStorage.getItem('token');


  // ── Card Auth handlers ─────────────────────────────────────────────────
  const fetchCardAuthList = async () => {
    setCardAuthLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/card-auth/list`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setCardAuthList(data.authorizations || []);
      setCardAuthFetched(true);
    } catch (e: any) {
      showToast(`Card auth fetch failed: ${e.message}`, 'error');
    } finally {
      setCardAuthLoading(false);
    }
  };

  const handleCreateCardAuth = async () => {
    if (!caPan || !caCode || !caAmount) { showToast('Card number, code and amount are required', 'error'); return; }
    if (caProtocol === '201.3' && !caCvv) { showToast('CVV required for 201.3', 'error'); return; }
    setCaCreating(true);
    try {
      const res = await fetch(`${BASE_URL}/api/card-auth/create`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardNumber: caPan, protocol: caProtocol, code: caCode.toUpperCase(),
          cvv: caCvv || undefined, amount: parseFloat(caAmount), currency: 'USD', merchantId: 'MRC-1001' }),
      });
      const data = await res.json();
      if (data.ok) { showToast(`✅ ${caProtocol} auth code created: ${data.code}`, 'success'); setCaCode(''); setCaCvv(''); setCaAmount(''); await fetchCardAuthList(); }
      else { showToast(data.error || 'Creation failed', 'error'); }
    } catch (e: any) { showToast(`Error: ${e.message}`, 'error'); }
    finally { setCaCreating(false); }
  };

  const handleValidateCardAuth = async () => {
    if (!caPan || !caValidateCode || !caAmount) {
      showToast('Card number, one-time code, and amount are required', 'error');
      return;
    }
    setCaValidating(true); setCaValidateResult(null);
    try {
      const res = await fetch(`${BASE_URL}/api/card-auth/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol: caProtocol,
          cardNumber: caPan,
          code: caValidateCode.toUpperCase(),
          cvv: caCvv || undefined,
          amount: parseFloat(caAmount),
          currency: 'USD',
          merchantId: 'MRC-1001',
        }),
      });
      const data = await res.json();
      setCaValidateResult(data);
      if (data.valid) showToast(`✅ VALID — ${caProtocol} code accepted`, 'success');
      else showToast(`❌ REJECTED: ${data.error}`, 'error');
    } catch (e: any) { showToast(`Error: ${e.message}`, 'error'); }
    finally { setCaValidating(false); }
  };

  const handleDeleteCardAuth = async (id: string, code: string) => {
    if (!window.confirm(`Delete auth code "${code}"?`)) return;
    setCaDeletingId(id);
    try {
      const res = await fetch(`${BASE_URL}/api/card-auth/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.ok) { showToast(`Deleted auth code ${code}`, 'success'); await fetchCardAuthList(); }
      else showToast(data.error || 'Delete failed', 'error');
    } catch (e: any) { showToast(`Error: ${e.message}`, 'error'); }
    finally { setCaDeletingId(null); }
  };

  const handleDeleteAllCardAuth = async () => {
    if (!window.confirm(`Delete ALL ${cardAuthList.length} auth codes? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${BASE_URL}/api/card-auth/all/purge`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.ok) { showToast('All auth codes deleted', 'success'); setCardAuthList([]); }
      else showToast(data.error || 'Delete failed', 'error');
    } catch (e: any) { showToast(`Error: ${e.message}`, 'error'); }
  };

  const handleValidateIntegration = async () => {
    if (!integrationApiKey.trim() || !integrationApiSecret.trim() || !integrationEndpointUrl.trim()) {
      setIntegrationValidation({ verified: false, reason: 'Enter an API key, API secret, and endpoint URL' });
      return;
    }

    setIntegrationValidating(true);
    setIntegrationValidation(null);
    try {
      const res = await fetch(`${BASE_URL}/api/developer/integration/validate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: integrationApiKey,
          apiSecret: integrationApiSecret,
          endpointUrl: integrationEndpointUrl,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setIntegrationValidation({
        verified:  res.ok && data.verified === true,
        reachable: data.reachable === true,
        reason:    data.reason || `Validation failed (HTTP ${res.status})`,
        httpStatus:           data.httpStatus,
        credentialsConfirmed: data.credentialsConfirmed === true,
      });
    } catch {
      setIntegrationValidation({ verified: false, reason: 'Validation request failed before the endpoint responded' });
    } finally {
      setIntegrationValidating(false);
    }
  };
  const fetchWiseStatus = async () => {
    setWiseLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/payout/wise/diagnostics`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setWiseStatus(data);
    } catch (e: any) {
      showToast(`Wise diagnostics failed: ${e.message}`, 'error');
    } finally {
      setWiseLoading(false);
    }
  };

  const fetchWiseWebhookEvents = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/payout/wise/webhook-events?limit=20`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      setWiseWebhookEvents(data.events || []);
      setWiseEventsFetched(true);
    } catch { /* ignore */ }
  };

  const runWiseSync = async () => {
    setWiseSyncing(true);
    setWiseSyncResult(null);
    try {
      const res = await fetch(`${BASE_URL}/api/payout/wise/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      setWiseSyncResult(data);
      if (data.ok) {
        const msg = [
          data.outbound_updated > 0 ? `${data.outbound_updated} payout(s) updated` : null,
          data.incoming_credited > 0 ? `${data.incoming_credited} incoming transfer(s) credited` : null,
          data.outbound_updated === 0 && data.incoming_credited === 0 ? 'Everything up to date' : null,
        ].filter(Boolean).join(' · ');
        showToast(`✅ Wise sync complete — ${msg}`, 'success');
        // Refresh balance and status
        await fetchWiseStatus();
      } else {
        showToast(data.message || data.error || 'Wise not configured', 'info');
      }
    } catch (e: any) {
      showToast(`Sync failed: ${e.message}`, 'error');
    } finally {
      setWiseSyncing(false);
    }
  };

  useEffect(() => {
    fetchWiseStatus();
  }, []);

  const fetchSettlementInstructions = async () => {
    setSettlementLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/payout/settlement-instructions/MRC-1001`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSettlementInstructions(data.instructions || []);
      setSettlementTotal(data.total_amount || 0);
      setSettlementFetched(true);
    } catch (e: any) {
      showToast(`Failed to load settlement instructions: ${e.message}`, 'error');
    } finally {
      setSettlementLoading(false);
    }
  };

  useEffect(() => {
    loadApiKey();
  }, []);

  const loadApiKey = async () => {
    try {
      setLoading(true);
      const profile = await getProfile();
      if (profile?.api_key) {
        setKeys([{
          id: 'key_1',
          name: 'Primary API Key',
          prefix: profile.api_key.substring(0, 15) + '...',
          created: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          status: 'ACTIVE',
          environment: profile.api_key.startsWith('sk_live') ? 'PRODUCTION' : 'TEST'
        }]);
      }
    } catch (error) {
      console.error("Failed to load API key:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateKey = async () => {
    try {
      setLoading(true);
      const result = await regenerateApiKey();
      if (result?.api_key) {
        setNewKey(result.api_key);
        setKeys([{
          id: 'key_1',
          name: 'Primary API Key',
          prefix: result.api_key.substring(0, 15) + '...',
          created: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          status: 'ACTIVE',
          environment: result.api_key.startsWith('sk_live') ? 'PRODUCTION' : 'TEST'
        }]);
      }
    } catch (error) {
      console.error("Failed to regenerate key:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (isoString: string | null) => {
    if (!isoString) return 'Never';
    return new Date(isoString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="animate-fade-in space-y-8 pb-12 max-w-7xl mx-auto">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Developer API Keys</h1>
          <p className="text-sm text-gray-500 mt-1">Manage API keys, webhooks, and integration settings</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleRegenerateKey}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-all flex items-center gap-2"
          >
            {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
            {!loading && <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
            {loading ? 'Generating...' : 'Regenerate API Key'}
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && !newKey && (
        <div className="flex items-center justify-center h-32">
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <div className="text-sm text-gray-500 font-medium">Loading Developer Settings...</div>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
            </div>
            <span className="text-xs font-semibold text-gray-500">Total Active</span>
          </div>
          <div className="text-sm font-medium text-gray-500">Active API Keys</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{keys.filter(k => k.status === 'ACTIVE').length}</div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm opacity-60">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
              <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
            <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-1 rounded-full">Pending Metrics</span>
          </div>
          <div className="text-sm font-medium text-gray-500">API Requests (24h)</div>
          <div className="text-sm font-medium text-gray-400 mt-2 italic">Monitoring integration required</div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm opacity-60">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-green-50 rounded-lg text-green-600">
              <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-1 rounded-full">Pending Metrics</span>
          </div>
          <div className="text-sm font-medium text-gray-500">Error Rate / Uptime</div>
          <div className="text-sm font-medium text-gray-400 mt-2 italic">Monitoring integration required</div>
        </div>
      </div>

      {/* New API Key Alert */}
      {newKey && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-green-100 rounded-lg text-green-600">
              <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-green-900">New API Key Generated!</h3>
              <p className="text-sm text-green-700 mt-1">
                Copy this key now - you won't be able to see it again!
              </p>
              <div className="mt-3 p-3 bg-white rounded-lg border border-green-200">
                <code className="text-sm font-mono text-gray-800 break-all">{newKey}</code>
              </div>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(newKey);
                  alert('API Key copied to clipboard!');
                }}
                className="mt-3 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
              >
                Copy to Clipboard
              </button>
            </div>
            <button 
              onClick={() => setNewKey(null)}
              className="text-green-600 hover:text-green-800"
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* Keys Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h3 className="text-sm font-bold text-gray-900">Standard Keys</h3>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span className="text-xs text-gray-500">Operational</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Key Token</th>
                <th className="px-6 py-4">Environment</th>
                <th className="px-6 py-4">Created</th>
                <th className="px-6 py-4">Last Used</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {keys.map((key) => (
                <tr key={key.id} className="hover:bg-gray-50/80 transition-colors">
                  <td className="px-6 py-4 text-sm font-bold text-gray-900">
                    {key.name}
                  </td>
                  <td className="px-6 py-4 text-xs font-mono text-gray-500 bg-gray-50/50 rounded p-1">
                    {key.prefix}
                  </td>
                  <td className="px-6 py-4 text-xs font-semibold">
                    <span className={`px-2 py-1 rounded-md ${key.environment === 'PRODUCTION' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                      {key.environment}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {formatDate(key.created)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {formatDate(key.lastUsed)}
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge status={key.status} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button className="text-gray-400 hover:text-gray-600 transition-colors" title="Rotate Key">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      </button>
                      <button className="text-red-400 hover:text-red-600 transition-colors" title="Revoke Key">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Webhooks / API integration validation */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Webhooks & API integration</h3>
            <p className="text-sm text-gray-500 mt-1">Validate a provider endpoint without saving its credentials</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">API key</label>
              <input type="text" value={integrationApiKey} onChange={e => setIntegrationApiKey(e.target.value)}
                autoComplete="off" className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">API secret</label>
              <input type="password" value={integrationApiSecret} onChange={e => setIntegrationApiSecret(e.target.value)}
                autoComplete="new-password" className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Endpoint URL (HTTPS)</label>
              <input type="url" value={integrationEndpointUrl} onChange={e => setIntegrationEndpointUrl(e.target.value)}
                placeholder="https://provider.example/validate" autoComplete="off" className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button onClick={handleValidateIntegration} disabled={integrationValidating}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
              {integrationValidating ? 'Validating...' : 'Validate endpoint'}
            </button>
            <p className="text-xs text-gray-500">Only a button press sends a request. Credentials are sent in headers, never in the URL or local storage.</p>
          </div>
          {integrationValidation && (
            <div className={`rounded-xl px-4 py-3 text-sm border space-y-1 ${
              integrationValidation.verified
                ? 'bg-green-50 border-green-200 text-green-800'
                : integrationValidation.reachable
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-red-50 border-red-200 text-red-800'}`}>
              <div className="font-bold flex items-center gap-2">
                {integrationValidation.verified
                  ? '✅ Credentials confirmed — endpoint is working'
                  : integrationValidation.reachable
                    ? '⚠️ Endpoint reachable — check credentials'
                    : '❌ Endpoint not reachable'}
                {integrationValidation.httpStatus && (
                  <span className="text-xs font-mono bg-white/60 px-1.5 py-0.5 rounded border border-current/20">
                    HTTP {integrationValidation.httpStatus}
                  </span>
                )}
              </div>
              <div className="text-xs font-medium opacity-80">{integrationValidation.reason}</div>
              <div className="flex gap-3 text-xs mt-1">
                <span>Reachable: <strong>{integrationValidation.reachable ? 'Yes' : 'No'}</strong></span>
                <span>Credentials: <strong>{integrationValidation.credentialsConfirmed ? 'Accepted' : 'Not confirmed'}</strong></span>
              </div>
            </div>
          )}
        </div>
      </div>

      {false && <>
      {/* Removed provider integration section. Configure the replacement provider through backend/.env. */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg">W</div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">🔀 Wise — Payout Rail</h3>
              <p className="text-sm text-gray-500 mt-0.5">Transport rail only — your internal acquirer (Protocol 201.3) is the provider. Wise carries the wire to the destination bank.</p>
            </div>
          </div>
          <button
            onClick={() => { fetchWiseStatus(); fetchWiseWebhookEvents(); }}
            disabled={wiseLoading}
            className="px-4 py-2 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition flex items-center gap-2"
          >
            {wiseLoading ? <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Checking...</> : '🔄 Refresh'}
          </button>
        </div>

        <div className="p-6 space-y-5">

          {/* Status banner */}
          {wiseStatus && (
            <div className={`rounded-xl p-4 border ${wiseStatus.configured ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              {wiseStatus.configured ? (
                <div>
                  <div className="flex items-center gap-2 text-green-800 font-bold">
                    <span>✅ Wise is configured and active</span>
                    <span className="text-xs font-mono bg-green-100 px-2 py-0.5 rounded">Profile: {wiseStatus.profileId}</span>
                  </div>
                  {wiseStatus.warnings?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {wiseStatus.warnings.map((w: string, i: number) => (
                        <div key={i} className="text-xs text-amber-700">⚠️ {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="font-bold text-amber-800">⚠️ Wise not configured yet</div>
                  <div className="text-sm text-amber-700 mt-1">Add your API key to backend/.env to activate all Wise features.</div>
                </div>
              )}
            </div>
          )}

          {/* Balances (C) */}
          {wiseStatus?.configured && wiseStatus?.balances?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">C — Live Wise Balances</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {wiseStatus.balances.map((b: any, i: number) => (
                  <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <div className="text-xs text-slate-500 font-semibold uppercase">{b.currency}</div>
                    <div className="text-xl font-extrabold text-slate-900 mt-1">
                      {Number(b.amount?.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Collect from Wise balance → ABSA ──────────────────────── */}
          {wiseStatus?.configured && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5">
              <div className="font-bold text-green-900 mb-1">💸 Collect from Wise Balance → ABSA</div>
              <div className="text-sm text-green-700 mb-3">
                Calls Wise API directly — takes funds from your Wise balance and sends to destination bank .
              </div>
              <div className="flex gap-3">
                <input
                  type="number"
                  value={collectAmount}
                  onChange={e => setCollectAmount(e.target.value)}
                  placeholder="Amount"
                  className="flex-1 px-3 py-2.5 rounded-lg border border-green-200 text-sm font-bold focus:outline-none"
                />
                <select
                  value={collectCurrency}
                  onChange={e => setCollectCurrency(e.target.value)}
                  className="px-3 py-2.5 rounded-lg border border-green-200 text-sm font-bold focus:outline-none"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
                <button
                  onClick={runWiseCollect}
                  disabled={wiseCollecting || !collectAmount}
                  className="px-5 py-2.5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-bold text-sm disabled:opacity-50 transition"
                >
                  {wiseCollecting ? '⏳ Sending...' : '💸 Send to destination bank'}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 bg-white border border-green-100 rounded-lg p-3 text-xs">
                <div><span className="text-green-600">Destination:</span> <span className="font-bold">JUKRUTI LOGISTICS PTY LTD</span></div>
                <div><span className="text-green-600">Bank:</span> <span className="font-bold">Destination Bank</span></div>
                <div><span className="text-green-600">Account:</span> <span className="font-mono font-bold"></span></div>
                <div><span className="text-green-600">SWIFT:</span> <span className="font-mono font-bold"></span></div>
              </div>
              {wiseCollectResult && (
                <div className={`mt-3 rounded-xl p-4 border text-sm ${wiseCollectResult.success ? 'bg-white border-green-200' : 'bg-red-50 border-red-200'}`}>
                  {wiseCollectResult.success ? (
                    <div className="space-y-1">
                      <div className="font-bold text-green-800">✅ Wise Transfer Created</div>
                      <div><span className="text-gray-500">Transfer ID:</span> <span className="font-mono">{wiseCollectResult.transferId}</span></div>
                      <div><span className="text-gray-500">Status:</span> <span className="font-bold">{wiseCollectResult.status}</span></div>
                      <div><span className="text-gray-500">Amount:</span> <span className="font-bold">{wiseCollectResult.currency} {Number(wiseCollectResult.amount).toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
                      <div><span className="text-gray-500">Wise Balance:</span> <span className="font-bold">{wiseCollectResult.currency} {Number(wiseCollectResult.wiseBalance||0).toLocaleString('en-US',{minimumFractionDigits:2})}</span></div>
                      <div className="text-xs text-gray-500 mt-1">{wiseCollectResult.message}</div>
                    </div>
                  ) : (
                    <div>
                      <div className="font-bold text-red-700">❌ {wiseCollectResult.message}</div>
                      {wiseCollectResult.wiseBalance !== undefined && (
                        <div className="text-xs text-gray-500 mt-1">Wise balance: {wiseCollectResult.currency} {Number(wiseCollectResult.wiseBalance).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Manual Sync (replaces webhooks for localhost) ─────────────── */}
          {wiseStatus?.configured && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-slate-900 flex items-center gap-2">
                    🔁 Manual Wise Sync
                    <span className="text-xs font-normal bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Replaces webhooks for localhost</span>
                  </div>
                  <div className="text-sm text-slate-500 mt-1">
                    Polls Wise API to update payout statuses (B) and credit incoming transfers (D) — no public URL needed.
                  </div>
                </div>
                <button
                  onClick={runWiseSync}
                  disabled={wiseSyncing}
                  className="shrink-0 flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold disabled:opacity-50 transition shadow-sm"
                >
                  {wiseSyncing ? (
                    <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Syncing...</>
                  ) : (
                    <>🔁 Sync Now</>
                  )}
                </button>
              </div>

              {/* Sync result */}
              {wiseSyncResult && (
                <div className={`mt-4 rounded-xl p-4 border ${wiseSyncResult.ok ? 'bg-white border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                  {wiseSyncResult.ok ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 font-semibold text-green-800">
                        ✅ Sync complete
                        <span className="text-xs text-gray-400 font-normal">{new Date(wiseSyncResult.synced_at).toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-green-50 border border-green-100 rounded-lg p-3 text-center">
                          <div className="text-2xl font-extrabold text-green-700">{wiseSyncResult.outbound_updated}</div>
                          <div className="text-xs text-green-600 font-medium mt-0.5">Payouts updated (B)</div>
                        </div>
                        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-center">
                          <div className="text-2xl font-extrabold text-blue-700">{wiseSyncResult.incoming_credited}</div>
                          <div className="text-xs text-blue-600 font-medium mt-0.5">Transfers credited (D)</div>
                        </div>
                        <div className={`border rounded-lg p-3 text-center ${wiseSyncResult.errors > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
                          <div className={`text-2xl font-extrabold ${wiseSyncResult.errors > 0 ? 'text-red-600' : 'text-gray-400'}`}>{wiseSyncResult.errors}</div>
                          <div className="text-xs text-gray-500 font-medium mt-0.5">Errors</div>
                        </div>
                      </div>

                      {/* Updated payouts */}
                      {wiseSyncResult.details?.outbound_updated?.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Updated Payouts</div>
                          <div className="space-y-1">
                            {wiseSyncResult.details.outbound_updated.map((p: any, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-xs bg-white border border-gray-100 rounded-lg px-3 py-2">
                                <span className="font-mono text-gray-500">{p.payout_id?.slice(0,8)}…</span>
                                <span className="text-gray-400">→</span>
                                <span className={`font-bold ${p.new_status === 'COMPLETED' ? 'text-green-700' : p.new_status === 'FAILED' ? 'text-red-600' : 'text-blue-600'}`}>{p.new_status}</span>
                                <span className="text-gray-400 font-mono text-[10px]">Wise: {p.transfer_id}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Credited transfers */}
                      {wiseSyncResult.details?.incoming_credited?.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Credited to Merchant Wallet</div>
                          <div className="space-y-1">
                            {wiseSyncResult.details.incoming_credited.map((t: any, i: number) => (
                              <div key={i} className="flex items-center gap-2 text-xs bg-white border border-green-100 rounded-lg px-3 py-2">
                                <span className="text-green-700 font-bold">▲ {t.currency} {Number(t.amount).toLocaleString('en-US', {minimumFractionDigits:2})}</span>
                                <span className="text-gray-400 font-mono">{t.transfer_id}</span>
                                {t.reference && <span className="text-gray-400">· {t.reference}</span>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Errors */}
                      {wiseSyncResult.details?.errors?.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-1">Errors</div>
                          {wiseSyncResult.details.errors.map((e: any, i: number) => (
                            <div key={i} className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{e.type}: {e.error}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-amber-800 text-sm">{wiseSyncResult.message || wiseSyncResult.error}</div>
                  )}
                </div>
              )}

              <div className="mt-3 text-xs text-slate-400">
                Tip: Run this after initiating a payout to check if Wise has processed it, or after expecting an incoming transfer from the card issuer.
              </div>
            </div>
          )}

          {/* Setup guide (when not configured) */}
          {wiseStatus && !wiseStatus.configured && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-5 space-y-3">
              <div className="font-bold text-blue-900">🚀 How to activate Wise (2 steps)</div>
              <div className="space-y-2 text-sm text-blue-800">
                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">1</span>
                  <div>
                    <div className="font-semibold">Get your Wise API key</div>
                    <div className="text-blue-600 text-xs mt-0.5">Configure the replacement provider using the generic payout API settings.</div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">2</span>
                  <div>
                    <div className="font-semibold">Add to backend/.env</div>
                    <code className="block mt-1 bg-blue-100 rounded p-2 text-xs font-mono text-blue-900 select-all">
                      BANK_PAYOUT_PROVIDER=wise{'\n'}
                      BANK_PAYOUT_PROVIDER=external{'\n'}
                      BANK_PAYOUT_API_URL=https://provider.example/api/payouts{'\n'}
                      BANK_PAYOUT_API_KEY=your_provider_key
                    </code>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-blue-200">
                <div className="font-semibold text-blue-900 mb-2">B+D — Register Wise Webhooks</div>
                <div className="text-xs text-blue-700 space-y-1">
                  <div>Configure the replacement provider webhook using its official documentation.</div>
                  <code className="block bg-blue-100 rounded p-2 font-mono text-blue-900 select-all">
                    POST https://your-server.com/webhooks/wise/webhook
                  </code>
                  <div className="mt-1">Subscribe to these events:</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {['incoming-transfer#credited', 'transfers#state-change', 'balance#credit'].map(e => (
                      <span key={e} className="bg-blue-200 text-blue-800 px-2 py-0.5 rounded font-mono text-[10px]">{e}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Webhook events log (B+D) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">B+D — Recent Webhook Events</div>
              {!wiseEventsFetched && (
                <button onClick={fetchWiseWebhookEvents} className="text-xs text-blue-600 hover:underline">Load events</button>
              )}
            </div>
            {wiseEventsFetched && wiseWebhookEvents.length === 0 && (
              <div className="text-center py-6 text-gray-400 border border-dashed border-gray-200 rounded-xl">
                <div className="text-2xl mb-1">📭</div>
                <div className="text-sm">No webhook events yet — register your webhook URL in Wise dashboard</div>
              </div>
            )}
            {wiseWebhookEvents.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-2 text-left text-gray-500 font-semibold uppercase">Event Type</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-semibold uppercase">Category</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-semibold uppercase">Merchant</th>
                      <th className="px-3 py-2 text-left text-gray-500 font-semibold uppercase">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {wiseWebhookEvents.map((ev: any) => (
                      <tr key={ev.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-blue-700">{ev.event_type}</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full font-bold ${
                            ev.event_category?.includes('credit') ? 'bg-green-100 text-green-700' :
                            ev.event_category?.includes('completed') ? 'bg-blue-100 text-blue-700' :
                            ev.event_category?.includes('failed') ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{ev.event_category}</span>
                        </td>
                        <td className="px-3 py-2 font-mono">{ev.merchant_id || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{new Date(ev.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Flow diagram */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Complete Flow</div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-700">
              {[
                'Card payment (POS)',
                '→',
                'Card issuer (global server)',
                '→',
                'Wise incoming webhook (D)',
                '→',
                'Merchant wallet credited',
                '→',
                'Click Pay Out',
                '→',
                'Wise API transfer (A)',
                '→',
                'Wise recipient account ✅',
              ].map((step, i) => (
                <span key={i} className={step === '→' ? 'text-blue-400 font-bold' : 'bg-white border border-slate-200 px-2 py-1 rounded'}>
                  {step}
                </span>
              ))}
            </div>
          </div>

        </div>
      </div>
      </>}

      {/* ── Settlement Instructions Section ───────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">🏦 Settlement Instructions</h3>
            <p className="text-sm text-gray-500 mt-1">
              Payout records generated by your internal acquirer (Protocol 201.3). New payouts call the configured provider when its API URL and credentials are configured; otherwise they remain pending for setup.
            </p>
          </div>
          <button
            onClick={fetchSettlementInstructions}
            disabled={settlementLoading}
            className="px-4 py-2 text-sm font-semibold bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {settlementLoading ? (
              <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Loading...</>
            ) : (
              <>{settlementFetched ? '🔄 Refresh' : '📥 Load Instructions'}</>
            )}
          </button>
        </div>

        {settlementFetched && (
          <div className="p-6">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                <div className="text-xs text-green-600 uppercase tracking-wider font-semibold">Total Instructions</div>
                <div className="text-2xl font-extrabold text-green-900 mt-1">{settlementInstructions.length}</div>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <div className="text-xs text-blue-600 uppercase tracking-wider font-semibold">Total Amount</div>
                <div className="text-2xl font-extrabold text-blue-900 mt-1">
                  ${settlementTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                <div className="text-xs text-slate-600 uppercase tracking-wider font-semibold">Destination</div>
                {settlementInstructions.length > 0 ? (
                  <>
                    <div className="text-sm font-bold text-slate-900 mt-1">
                      {settlementInstructions[0].destination_bank || 'Configured payout provider'}
                      {settlementInstructions[0].destination_account_number
                        ? ` ${settlementInstructions[0].destination_account_number}`
                        : ''}
                    </div>
                    <div className="text-xs text-slate-500">
                      {settlementInstructions[0].destination_account_holder || 'Recipient account'}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-bold text-slate-900 mt-1">No destination configured</div>
                    <div className="text-xs text-slate-500">No settlement instructions loaded</div>
                  </>
                )}
              </div>
            </div>

            {settlementInstructions.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <div className="text-4xl mb-2">📋</div>
                <div className="font-medium">No settlement instructions yet</div>
                <div className="text-sm mt-1">Initiate a payout from the Settlements page to generate one</div>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Reference</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Bank</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Account</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {settlementInstructions.map((inst: any) => (
                      <tr key={inst.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-blue-700">{inst.reference}</td>
                        <td className="px-4 py-3 font-bold text-gray-900">
                          {inst.currency} {Number(inst.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{inst.destination_bank || 'Configured payout provider'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">
                          {inst.destination_account_number}
                          {inst.destination_swift && <span className="ml-1 text-gray-400">· {inst.destination_swift}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                            inst.status === 'SENT'    ? 'bg-green-100 text-green-800' :
                            inst.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {inst.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {new Date(inst.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* API endpoint info */}
            <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="text-xs text-slate-500 font-medium mb-1">Direct API endpoint</div>
              <code className="text-xs font-mono text-slate-700 select-all">
                GET /api/payout/settlement-instructions/MRC-1001
              </code>
            </div>
          </div>
        )}

        {!settlementFetched && (
          <div className="p-10 text-center text-gray-400">
            <div className="text-4xl mb-3">🏦</div>
            <div className="font-medium text-gray-500">Click "Load Instructions" to view your settlement records</div>
            <div className="text-sm mt-1">Payouts are processed by the configured provider (Protocol 201.3)</div>
          </div>
        )}
      </div>

      {/* ── MT103 SWIFT Wire Section ─────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">🏛 MT103 SWIFT Wire Generator</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Generate ISO 15022 MT103 messages for international wire transfers — upload to your bank or correspondent
            </p>
          </div>
          <button
            onClick={fetchMt103List}
            disabled={mt103Loading}
            className="px-4 py-2 text-sm font-semibold bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 transition flex items-center gap-2"
          >
            {mt103Loading ? <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Loading...</> : '📋 Load MT103s'}
          </button>
        </div>

        <div className="p-6 space-y-5">

          {/* Generate new MT103 */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <div className="font-bold text-slate-900 mb-3">Generate New MT103</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Amount</label>
                <input
                  type="number" min="0.01" step="0.01"
                  value={mt103Amount}
                  onChange={e => setMt103Amount(e.target.value)}
                  placeholder="25000.00"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-slate-400/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Currency</label>
                <select
                  value={mt103Currency}
                  onChange={e => setMt103Currency(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm font-bold focus:outline-none"
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="ZAR">ZAR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Remittance Info</label>
                <input
                  type="text"
                  value={mt103RemInfo}
                  onChange={e => setMt103RemInfo(e.target.value)}
                  placeholder="POS settlement batch..."
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400/20"
                />
              </div>
            </div>

            {/* Beneficiary preview */}
            <div className="mt-3 grid grid-cols-2 gap-3 bg-white border border-slate-100 rounded-lg p-3 text-xs">
              <div><span className="text-slate-400">Sender BIC:</span> <span className="font-mono font-bold">PRSTUS33XXX</span></div>
              <div><span className="text-slate-400">Sender:</span> <span className="font-bold">PRIMESTACK TECHNOLOGIES LLC</span></div>
              <div><span className="text-slate-400">Beneficiary BIC:</span> <span className="font-mono font-bold"></span></div>
              <div><span className="text-slate-400">Account:</span> <span className="font-mono font-bold"></span></div>
              <div><span className="text-slate-400">Beneficiary:</span> <span className="font-bold">JUKRUTI LOGISTICS PTY LTD</span></div>
              <div><span className="text-slate-400">Charge:</span> <span className="font-bold">SHA</span></div>
            </div>

            <button
              onClick={generateMt103}
              disabled={mt103Generating || !mt103Amount}
              className="mt-3 w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm disabled:opacity-50 transition"
            >
              {mt103Generating ? '⏳ Generating...' : `🏛 Generate MT103 — ${mt103Currency} ${parseFloat(mt103Amount || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            </button>
          </div>

          {/* MT103 preview */}
          {mt103Preview && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-bold text-green-800">✅ MT103 Generated</div>
                <button
                  onClick={() => downloadMt103(mt103Preview.id, mt103Preview.reference, mt103Preview.value_date)}
                  className="px-3 py-1.5 bg-green-700 text-white rounded-lg text-xs font-bold hover:bg-green-800 transition"
                >
                  📥 Download .txt
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div><span className="text-green-600">UETR:</span> <span className="font-mono">{mt103Preview.uetr}</span></div>
                <div><span className="text-green-600">Reference:</span> <span className="font-mono">{mt103Preview.reference}</span></div>
                <div><span className="text-green-600">Amount:</span> <span className="font-bold">{mt103Preview.currency} {Number(mt103Preview.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
                <div><span className="text-green-600">Value Date:</span> <span className="font-mono">{mt103Preview.value_date}</span></div>
              </div>
              <pre className="bg-white border border-green-100 rounded-lg p-3 text-xs font-mono text-slate-700 overflow-x-auto whitespace-pre-wrap">{mt103Preview.message_preview}</pre>
            </div>
          )}

          {/* MT103 list */}
          {mt103Fetched && (
            <>
              {mt103List.length === 0 ? (
                <div className="text-center py-8 text-gray-400 border border-dashed border-gray-200 rounded-xl">
                  <div className="text-3xl mb-2">🏛</div>
                  <div className="font-medium">No MT103 messages yet</div>
                  <div className="text-sm mt-1">Generate one above — then download and upload to your bank</div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        <th className="px-3 py-2.5 text-gray-500 font-semibold uppercase">Reference</th>
                        <th className="px-3 py-2.5 text-gray-500 font-semibold uppercase">Amount</th>
                        <th className="px-3 py-2.5 text-gray-500 font-semibold uppercase">Beneficiary</th>
                        <th className="px-3 py-2.5 text-gray-500 font-semibold uppercase">UETR</th>
                        <th className="px-3 py-2.5 text-gray-500 font-semibold uppercase">Status</th>
                        <th className="px-3 py-2.5 text-gray-500 font-semibold uppercase">Date</th>
                        <th className="px-3 py-2.5 text-gray-500 font-semibold uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {mt103List.map((m: any) => (
                        <tr key={m.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5 font-mono text-blue-700">{m.internal_reference}</td>
                          <td className="px-3 py-2.5 font-bold">{m.currency} {Number(m.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2.5">
                            <div className="font-medium">{m.beneficiary_name}</div>
                            <div className="text-gray-400 font-mono">{m.beneficiary_account}</div>
                          </td>
                          <td className="px-3 py-2.5 font-mono text-gray-400">{m.uetr?.slice(0, 8)}…</td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded-full font-bold ${
                              m.status === 'CONFIRMED' ? 'bg-green-100 text-green-700' :
                              m.status === 'SENT'      ? 'bg-blue-100 text-blue-700' :
                              'bg-amber-100 text-amber-700'
                            }`}>{m.status}</span>
                          </td>
                          <td className="px-3 py-2.5 text-gray-500">{new Date(m.created_at).toLocaleString()}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => downloadMt103(m.id, m.internal_reference, m.value_date)}
                                className="px-2 py-1 bg-slate-700 text-white rounded text-[10px] font-bold hover:bg-slate-800"
                                title="Download MT103 .txt"
                              >📥 DL</button>
                              {m.status === 'DRAFT' && (
                                <button
                                  onClick={() => markMt103Sent(m.id)}
                                  className="px-2 py-1 bg-blue-600 text-white rounded text-[10px] font-bold hover:bg-blue-700"
                                  title="Mark as Sent to bank"
                                >✉️ Sent</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* How it works */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600">
            <div className="font-bold text-slate-800 mb-2">How to use MT103</div>
            <ol className="space-y-1 list-decimal list-inside">
              <li>Enter amount and currency → click <strong>Generate MT103</strong></li>
              <li>Click <strong>📥 Download</strong> to save the .txt file</li>
              <li>Upload the .txt to your bank's SWIFT upload portal or send to your correspondent bank</li>
              <li>Click <strong>✉️ Sent</strong> to mark it as submitted</li>
              <li>Once bank confirms — funds arrive in beneficiary account (JUKRUTI / ABSA)</li>
            </ol>
          </div>


      {/* ══════════════════════════════════════════════════════════
           CARD AUTHORIZATION MANAGER — 101.1 / 101.6 / 201.3
      ══════════════════════════════════════════════════════════ */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900">🔐 Card Authorization Manager</h3>
              <p className="text-sm text-gray-500 mt-1">
                Register, test, and view pre-authorization codes for Protocols 101.1 (Voice), 101.6 (EMV), 201.3 (Offline Batch).
                The POS processor validates codes here before approving any card payment.
              </p>
            </div>
            <button onClick={fetchCardAuthList} disabled={cardAuthLoading}
              className="shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
              {cardAuthLoading ? '⏳ Loading...' : '🔄 Load Auth Codes'}
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">

          {/* Protocol selector */}
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Protocol</p>
            <div className="grid grid-cols-3 gap-3">
              {([["101.1","📞","Voice Auth","amber"],["101.6","💳","EMV Chip","blue"],["201.3","🔒","Offline Batch","purple"]] as const).map(([proto,icon,label,color])=>(
                <button key={proto} type="button" onClick={()=>setCaProtocol(proto as '101.1'|'101.6'|'201.3')}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 text-xs font-bold transition-all
                    ${caProtocol===proto
                      ? color==='purple' ? 'border-purple-500 bg-purple-50 text-purple-800'
                      : color==='amber'  ? 'border-amber-400 bg-amber-50 text-amber-800'
                      : 'border-blue-500 bg-blue-50 text-blue-800'
                      : 'border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300'}`}
                >
                  <span className="text-lg">{icon}</span>
                  <span className="font-mono">{proto}</span>
                  <span className="font-normal opacity-70">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Create new auth code */}
          <div className="border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-widest">➕ Register New Auth Code</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Card Number (PAN)</label>
                <input type="text" value={caPan} onChange={e=>setCaPan(e.target.value.replace(/\D/g,"").substring(0,19))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono outline-none focus:border-indigo-500"
                  placeholder="4451470024994643" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Auth Code *</label>
                <input type="text" value={caCode} onChange={e=>setCaCode(e.target.value.replace(/[^a-zA-Z0-9-]/g,"").substring(0,32))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono outline-none focus:border-indigo-500 uppercase"
                  placeholder={caProtocol==='201.3' ? 'e.g. 9834' : caProtocol==='101.1' ? 'e.g. 000004' : 'e.g. TOKEN-001'} />
              </div>
              {caProtocol==='201.3' && (
                <div>
                  <label className="block text-xs font-semibold text-purple-600 uppercase mb-1">CVV * (201.3 only)</label>
                  <input type="password" value={caCvv} onChange={e=>setCaCvv(e.target.value.replace(/\D/g,"").substring(0,4))}
                    className="w-full px-3 py-2 border-2 border-purple-300 rounded-lg text-sm font-mono outline-none focus:border-purple-500 bg-purple-50"
                    placeholder="123" />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Amount (USD)</label>
                <input type="number" value={caAmount} onChange={e=>setCaAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-500"
                  placeholder="50000" />
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={handleCreateCardAuth} disabled={caCreating}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
                {caCreating ? '⏳ Registering...' : '✅ Register Auth Code'}
              </button>
              <button onClick={handleDeleteAllCardAuth} disabled={cardAuthList.length === 0}
                className="px-5 py-2 bg-red-50 hover:bg-red-100 disabled:opacity-40 border border-red-200 text-red-600 text-sm font-semibold rounded-lg transition flex items-center gap-2">
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                Delete All Codes
              </button>
            </div>
          </div>

          {/* Validate / test a code */}
          <div className="border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-widest">🔍 Validate one-time card authorization code</p>
            <p className="text-xs text-gray-500">This checks a single-use code against the selected card, amount, and protocol. It is not a provider/API health check.</p>
            <div className="flex gap-3 items-end flex-wrap">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Card (PAN)</label>
                <input type="text" value={caPan} onChange={e=>setCaPan(e.target.value.replace(/\D/g,"").substring(0,19))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono outline-none focus:border-indigo-500 w-52"
                  placeholder="Card number" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Amount (USD)</label>
                <input type="number" min="0.01" value={caAmount} onChange={e=>setCaAmount(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-indigo-500 w-32"
                  placeholder="Amount" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Code to Test</label>
                <input type="text" value={caValidateCode} onChange={e=>setCaValidateCode(e.target.value.replace(/[^a-zA-Z0-9-]/g,""))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono outline-none focus:border-indigo-500 uppercase w-44"
                  placeholder="Enter code..." />
              </div>
              {caProtocol==='201.3' && (
                <div>
                  <label className="block text-xs font-semibold text-purple-600 uppercase mb-1">CVV</label>
                  <input type="password" value={caCvv} onChange={e=>setCaCvv(e.target.value.replace(/\D/g,"").substring(0,4))}
                    className="px-3 py-2 border-2 border-purple-300 rounded-lg text-sm font-mono outline-none focus:border-purple-500 bg-purple-50 w-24"
                    placeholder="123" />
                </div>
              )}
              <button onClick={handleValidateCardAuth} disabled={caValidating || !caPan || !caAmount}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition">
                {caValidating ? '⏳' : '🔍 Validate'}
              </button>
            </div>
            {caValidateResult && (
              <div className={`rounded-xl px-4 py-3 text-sm font-semibold border ${caValidateResult.valid
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-red-50 border-red-200 text-red-800'}`}>
                {caValidateResult.valid
                  ? `✅ VALID — ${caProtocol} auth code accepted. ID: ${caValidateResult.authorizationId?.slice(0,8)}...`
                  : `❌ REJECTED — ${caValidateResult.error}`}
              </div>
            )}
          </div>

          {/* Registered codes table */}
          {cardAuthFetched && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
                Registered Authorization Codes ({cardAuthList.length})
              </p>
              {cardAuthList.length > 0 && (
                <div className="flex justify-end mb-2">
                  <button
                    onClick={handleDeleteAllCardAuth}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 text-xs font-bold transition-colors"
                  >
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    Delete All
                  </button>
                </div>
              )}
              {cardAuthList.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-xl">
                  No auth codes registered yet — create one above
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs font-bold text-gray-500 uppercase tracking-wider">
                        <th className="text-left py-2 px-3">Protocol</th>
                        <th className="text-left py-2 px-3">Auth Code</th>
                        <th className="text-left py-2 px-3">CVV</th>
                        <th className="text-left py-2 px-3">Card (PAN)</th>
                        <th className="text-right py-2 px-3">Amount</th>
                        <th className="text-center py-2 px-3">Status</th>
                        <th className="text-left py-2 px-3">Created</th>
                        <th className="text-right py-2 px-3">Action</th>
                        <th className="text-right py-2 px-3">Amount</th>
                        <th className="text-center py-2 px-3">Status</th>
                        <th className="text-left py-2 px-3">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {cardAuthList.map((a: any) => (
                        <tr key={a.id} className="hover:bg-gray-50/80 transition-colors">
                          <td className="py-2 px-3">
                            <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-bold
                              ${a.protocol==='201.3' ? 'bg-purple-100 text-purple-700'
                              : a.protocol==='101.1' ? 'bg-amber-100 text-amber-700'
                              : 'bg-blue-100 text-blue-700'}`}>{a.protocol}</span>
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-gray-800 tracking-widest">{a.code}</td>
                          <td className="py-2 px-3 font-mono text-gray-500">{a.cvv || <span className="text-gray-300 text-xs">N/A</span>}</td>
                          <td className="py-2 px-3 font-mono text-xs text-gray-500">{a.pan_masked || String(a.card_number||'').replace(/^(.{6})(.+)(.{4})$/,'$1****$3')}</td>
                          <td className="py-2 px-3 text-right font-mono">${Number(a.amount||0).toLocaleString()}</td>
                          <td className="py-2 px-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold
                              ${a.status==='ACTIVE' ? 'bg-green-100 text-green-700'
                              : a.status==='USED'   ? 'bg-gray-100 text-gray-500'
                              : 'bg-red-100 text-red-600'}`}>{a.status}</span>
                          </td>
                          <td className="py-2 px-3 text-xs text-gray-400">{a.created_at ? new Date(a.created_at).toLocaleDateString() : '-'}</td>
                          <td className="py-2 px-3 text-right">
                            <button
                              onClick={() => handleDeleteCardAuth(a.id, a.code)}
                              disabled={caDeletingId === a.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 text-xs font-semibold transition-colors disabled:opacity-50"
                              title="Delete this auth code"
                            >
                              {caDeletingId === a.id ? '...' : (
                                <>
                                  <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                  Delete
                                </>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Info box */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600">
            <div className="font-bold text-slate-800 mb-2">How Protocol Validation Works</div>
            <ul className="space-y-1 list-disc list-inside">
              <li><strong>101.1 Voice Auth</strong> — Enter the code given verbally by the issuer. CVV not required.</li>
              <li><strong>101.6 EMV Chip</strong> — Token returned by the online chip authorization. CVV required at POS.</li>
              <li><strong>201.3 Offline Batch</strong> — Requires both a pre-registered auth code <em>and</em> the correct CVV. Wrong code or wrong CVV = hard decline.</li>
              <li>All codes are matched against this table before the POS processor approves any transaction.</li>
            </ul>
          </div>

        </div>
      </div>
        </div>
      </div>
    </div>
  );
};