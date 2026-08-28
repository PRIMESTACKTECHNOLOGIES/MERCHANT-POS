import { useState, useEffect, useMemo } from "react";
import { useToast } from "../components/ui/Toast";
import { TableSkeleton } from "../components/ui/Skeleton";
import { fetchTerminals, forceTerminalReboot, regenerateTerminalSecret, registerTerminal } from "../lib/api";
import type { Terminal } from "../types"; // Changed to type-only import

// --- Icons ---
const Icons = {
  Search: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>,
  Filter: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>,
  Wifi: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" /></svg>,
  WifiOff: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18M12 20h.01M8.111 16.404a5.5 5.5 0 012.828-1.415m4.95.95a5.5 5.5 0 010 1.415M4.929 12.929c1.905-1.905 4.34-2.88 6.848-2.92m5.84 1.506c1.1.58 2.1 1.36 2.951 2.21M1.394 9.393c2.427-2.427 5.48-3.96 8.766-4.33m5.84.45c2.47.88 4.7 2.3 6.607 4.207" /></svg>,
  Battery: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
  Printer: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>,
  Key: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>,
  Alert: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
  X: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
  Check: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>,
  Refresh: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
  CloudOff: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>,
  Terminal: () => <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
};

// --- Helper Components ---
const StatusBadge = ({ status, onReboot }: { status: string | undefined, onReboot?: () => void }) => {
  const s = status || 'OFFLINE';
  const styles: Record<string, string> = {
    ONLINE: "bg-green-100 text-green-800 border-green-200",
    OFFLINE: "bg-gray-100 text-gray-800 border-gray-200",
    WARNING: "bg-amber-100 text-amber-800 border-amber-200",
    ERROR: "bg-red-100 text-red-800 border-red-200",
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[s] || styles.OFFLINE}`}>
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${s === 'ONLINE' ? 'bg-green-500' : s === 'OFFLINE' ? 'bg-gray-500' : s === 'WARNING' ? 'bg-amber-500' : 'bg-red-500'}`}></span>
      {s}
    </span>
  );
};

// --- Main Page Component ---
export const TerminalsPage = () => {
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showConfigureModal, setShowConfigureModal] = useState<Terminal | null>(null);
  const [newTerminalName, setNewTerminalName] = useState("");
  const [registrationResult, setRegistrationResult] = useState<{
    merchantId: string;
    terminalId: string;
    secretKey: string;
  } | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadTerminals();
  }, []);

  const loadTerminals = async () => {
    try {
      setLoading(true);
      const data = await fetchTerminals();
      setTerminals(data.map((t: any) => ({
        ...t,
        status: 'OFFLINE', // Default until heartbeat implemented
        ipAddress: '-',
        appVersion: 'v1.0'
      })));
    } catch (e) {
      console.error(e);
      showToast("Failed to load terminals", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!newTerminalName) return;
    try {
      const created = await registerTerminal(newTerminalName);
      const merchantId = created?.merchantId || created?.merchant_id || "MRC-1001";
      const terminalId = created?.terminalId || created?.terminal_id;
      const secretKey = created?.secretKey || created?.terminalSecret || created?.terminal_secret;

      if (terminalId && secretKey) {
        setRegistrationResult({ merchantId, terminalId, secretKey });
      }
      showToast("Terminal registered successfully", "success");
      setShowRegisterModal(false);
      setNewTerminalName("");
      loadTerminals();
    } catch (e) {
      showToast("Failed to register terminal", "error");
    }
  };

  const handleRegenerateKey = async () => {
    if (!showConfigureModal) return;
    try {
      showToast("Regenerating key...", "info");
      const merchantId = showConfigureModal.merchantId || "MRC-1001";
      const result = await regenerateTerminalSecret(merchantId, showConfigureModal.terminalId);
      const terminalId = result?.terminalId || showConfigureModal.terminalId;
      const secretKey = result?.secretKey || result?.terminalSecret || result?.terminal_secret;
      if (terminalId && secretKey) {
        setRegistrationResult({ merchantId, terminalId, secretKey });
        showToast("New secret key generated", "success");
      } else {
        showToast("Secret key generated, but not returned by server", "error");
      }
    } catch (e) {
      showToast("Failed to regenerate key", "error");
    }
  };

  const handleRemoteReboot = async () => {
    if (!showConfigureModal) return;
    try {
      const merchantId = showConfigureModal.merchantId || "MRC-1001";
      await forceTerminalReboot(merchantId, showConfigureModal.terminalId);
      showToast("Reboot command sent to terminal", "success");
      loadTerminals();
    } catch (e) {
      showToast("Failed to send reboot command", "error");
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in">
      
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Terminals</h1>
          <p className="text-gray-500 mt-1">Manage your POS fleet, keys, and offline policies</p>
        </div>
        <div className="flex gap-3">
           <button 
             onClick={() => setShowRegisterModal(true)}
             className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 shadow-sm transition-all active:scale-[0.98]"
           >
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
             Register New Terminal
           </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total Terminals</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{terminals.length}</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
           <p className="text-sm font-medium text-gray-500">Active (Online)</p>
           <p className="mt-2 text-3xl font-bold text-gray-900">{terminals.filter(t => t.status === 'ONLINE').length}</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
           <p className="text-sm font-medium text-gray-500">Offline Enabled</p>
           <p className="mt-2 text-3xl font-bold text-gray-900">{terminals.filter(t => t.offlineEnabled).length}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <TableSkeleton rows={5} />
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Terminal</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Seen</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {terminals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No terminals found. Register one to get started.
                  </td>
                </tr>
              ) : (
                terminals.map((terminal) => (
                  <tr key={terminal.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500">
                          <Icons.Terminal />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{terminal.name}</div>
                          <div className="text-sm text-gray-500">ID: {terminal.terminalId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={terminal.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {terminal.id.startsWith('WEB') ? 'Web POS' : 'Android App'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {terminal.lastBatchAt ? new Date(terminal.lastBatchAt).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button 
                        onClick={() => setShowConfigureModal(terminal)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        Configure
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Register Modal */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl animate-scale-in">
            <h3 className="text-xl font-bold mb-2 text-gray-900">Register New Terminal</h3>
            <p className="text-sm text-gray-500 mb-6">Assign a name and branch to identify your new POS device.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Terminal Name / Branch</label>
                <input 
                  type="text" 
                  autoFocus
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  placeholder="e.g. Downtown Branch 1"
                  value={newTerminalName}
                  onChange={(e) => setNewTerminalName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-8">
              <button onClick={() => setShowRegisterModal(false)} className="px-5 py-2.5 text-gray-600 font-semibold hover:bg-gray-100 rounded-xl transition-colors">Cancel</button>
              <button 
                onClick={handleRegister} 
                disabled={!newTerminalName}
                className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
              >
                Register
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Registration Result Modal */}
      {registrationResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl animate-scale-in">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Terminal Registered</h3>
                <p className="text-sm text-gray-500 mt-1">Copy these values to your Android POS Setup screen.</p>
              </div>
              <button onClick={() => setRegistrationResult(null)} className="text-gray-400 hover:text-gray-600">
                <Icons.X />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-4 border border-gray-100 rounded-xl bg-gray-50">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Merchant ID</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono font-bold text-gray-900">{registrationResult.merchantId}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(registrationResult.merchantId)}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="p-4 border border-gray-100 rounded-xl bg-gray-50">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Terminal ID</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono font-bold text-gray-900">{registrationResult.terminalId}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(registrationResult.terminalId)}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="p-4 border border-amber-100 rounded-xl bg-amber-50">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1">Terminal Secret Key</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono font-bold text-amber-900 break-all">{registrationResult.secretKey}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(registrationResult.secretKey)}
                    className="text-amber-800 hover:text-amber-900 text-sm font-medium"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-xs text-amber-700 mt-2">
                  Keep this secret. If you lose it, you must regenerate and reconfigure the terminal.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setRegistrationResult(null)}
                className="px-6 py-2.5 bg-gray-900 text-white font-bold rounded-xl hover:bg-black transition-all active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Configure Modal */}
      {showConfigureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl animate-scale-in">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Configure Terminal</h3>
                <p className="text-sm text-gray-500 mt-1">Terminal ID: <span className="font-mono font-bold text-blue-600">{showConfigureModal.terminalId}</span></p>
              </div>
              <button onClick={() => setShowConfigureModal(null)} className="text-gray-400 hover:text-gray-600">
                <Icons.X />
              </button>
            </div>
            
            <div className="space-y-6">
              <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                <div className="flex gap-3">
                  <div className="text-amber-600 mt-0.5"><Icons.Alert /></div>
                  <div>
                    <p className="text-sm font-bold text-amber-900">Security Notice</p>
                    <p className="text-xs text-amber-700 mt-1">Regenerating the secret key will disconnect the terminal until it is updated on the physical device.</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 border border-gray-100 rounded-xl bg-gray-50">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Status</p>
                  <StatusBadge status={showConfigureModal.status} />
                </div>
                <div className="p-4 border border-gray-100 rounded-xl bg-gray-50">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Offline Capable</p>
                  <p className="text-sm font-bold text-gray-900">Yes (Unlimited)</p>
                </div>
              </div>

              <div className="space-y-3">
                  <button 
                    onClick={handleRegenerateKey}
                    className="w-full py-3 px-4 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold flex items-center justify-between hover:bg-gray-50 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                       <div className="p-2 bg-blue-100 text-blue-600 rounded-lg group-hover:bg-blue-200"><Icons.Key /></div>
                       <span className="text-sm">Regenerate Secret Key</span>
                    </div>
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                  <button 
                    onClick={handleRemoteReboot}
                    className="w-full py-3 px-4 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold flex items-center justify-between hover:bg-gray-50 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                       <div className="p-2 bg-purple-100 text-purple-600 rounded-lg group-hover:bg-purple-200"><Icons.Wifi /></div>
                       <span className="text-sm">Force Remote Reboot</span>
                    </div>
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
               </div>
            </div>

            <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-gray-100">
              <button onClick={() => setShowConfigureModal(null)} className="px-5 py-2.5 bg-gray-900 text-white font-bold rounded-xl hover:bg-black transition-all shadow-lg active:scale-[0.98]">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
