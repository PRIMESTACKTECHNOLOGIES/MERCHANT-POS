import { useEffect, useState } from "react";
import { regenerateApiKey, getProfile } from "../lib/api";

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
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

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

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-purple-50 rounded-lg text-purple-600">
              <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
            <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full">Normal</span>
          </div>
          <div className="text-sm font-medium text-gray-500">API Requests (24h)</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">142.5k</div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-green-50 rounded-lg text-green-600">
              <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full">99.99% Uptime</span>
          </div>
          <div className="text-sm font-medium text-gray-500">Error Rate</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">0.02%</div>
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

      {/* Webhooks Section */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-lg font-bold text-gray-900">Webhooks</h3>
          <p className="text-sm text-gray-500 mt-1">Listen for events on your account</p>
        </div>
        <div className="p-6">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
               <div className="p-2 bg-white border border-gray-200 rounded shadow-sm">
                  <svg width="20" height="20" className="text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
               </div>
               <div>
                  <div className="text-sm font-bold text-gray-900">https://api.merchant.com/webhooks/pos</div>
                  <div className="text-xs text-gray-500">Listening for <span className="font-mono bg-gray-200 px-1 rounded">payment.success</span>, <span className="font-mono bg-gray-200 px-1 rounded">batch.closed</span></div>
               </div>
            </div>
            <div className="flex items-center gap-2">
               <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
               </span>
               <span className="text-xs font-medium text-green-700">Active</span>
               <button className="ml-4 text-sm font-medium text-blue-600 hover:text-blue-800">Edit</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
