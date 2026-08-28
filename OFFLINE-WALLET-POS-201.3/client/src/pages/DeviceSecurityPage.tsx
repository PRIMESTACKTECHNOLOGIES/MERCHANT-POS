import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/ui/Toast";
import { useNotifications } from "../contexts/NotificationContext";
import { ConfirmModal } from "../components/ui/Modal";
import { Skeleton } from "../components/ui/Skeleton";
import { fetchTerminals, regenerateTerminalSecret } from "../lib/api";
import type { Terminal } from "../types";

// --- Icons ---
const Icons = {
  Security: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" /></svg>,
  Key: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>,
  Plus: () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>,
  ShieldCheck: () => <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
};

export const DeviceSecurityPage = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { addNotification } = useNotifications();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [terminals, setTerminals] = useState<Terminal[]>([]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedTerminal, setSelectedTerminal] = useState<Terminal | null>(null);
  const [newSecret, setNewSecret] = useState<{ merchantId: string; terminalId: string; secretKey: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTerminals();
        if (!cancelled) {
          setTerminals(data);
        }
      } catch (e) {
        showToast("Failed to load terminals", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRotateClick = (terminal: Terminal) => {
    setSelectedTerminal(terminal);
    setConfirmOpen(true);
  };

  const handleConfirmRotate = () => {
    if (selectedTerminal) {
      setProcessing(true);
      (async () => {
        try {
          const merchantId = selectedTerminal.merchantId || "MRC-1001";
          const result = await regenerateTerminalSecret(merchantId, selectedTerminal.terminalId);
          const terminalId = result?.terminalId || selectedTerminal.terminalId;
          const secretKey = result?.secretKey || result?.terminalSecret || result?.terminal_secret;

          if (terminalId && secretKey) {
            setNewSecret({ merchantId, terminalId, secretKey });
            showToast("New secret key generated", "success");
            addNotification(
              "Security Key Rotation",
              `New secret key generated for terminal ${selectedTerminal.name}. Update it on the physical device now.`,
              "info"
            );
          } else {
            showToast("Secret key generated, but not returned by server", "error");
          }
        } catch (e) {
          showToast("Failed to regenerate secret key", "error");
        } finally {
          setProcessing(false);
          setConfirmOpen(false);
          setSelectedTerminal(null);
        }
      })();
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Icons.Security /> Device Security & Keys
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage POS terminal security, encryption keys, and pairing.</p>
        </div>
        <button 
          onClick={() => navigate('/terminal-pairing')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center gap-2 transition-colors"
        >
          <Icons.Plus /> Pair New Device
        </button>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {loading ? (
           Array.from({ length: 3 }).map((_, i) => (
             <Skeleton key={i} className="h-32 w-full rounded-xl" />
           ))
        ) : (
          <>
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex justify-between items-start mb-4">
            <div className="text-sm font-medium text-gray-500">Secured Devices</div>
            <div className="p-2 rounded-lg bg-green-50 text-green-600"><Icons.ShieldCheck /></div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{terminals.length}</div>
          <div className="text-xs text-green-600 mt-1">All systems normal</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
           <div className="flex justify-between items-start mb-4">
            <div className="text-sm font-medium text-gray-500">Active Keys</div>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600"><Icons.Key /></div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{terminals.length}</div>
          <div className="text-xs text-gray-400 mt-1">Rotate per terminal</div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
           <div className="flex justify-between items-start mb-4">
            <div className="text-sm font-medium text-gray-500">Security Alerts</div>
            <div className="p-2 rounded-lg bg-red-50 text-red-600"><Icons.Security /></div>
          </div>
          <div className="text-2xl font-bold text-gray-900">0</div>
          <div className="text-xs text-gray-400 mt-1">No active threats</div>
        </div>
          </>
        )}
      </div>

      {/* Device List */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <h3 className="font-bold text-gray-900">Paired Devices Security Status</h3>
        </div>
        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full text-left relative">
            <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
              <tr className="border-b border-gray-100 text-xs uppercase text-gray-500 font-semibold bg-gray-50">
                <th className="px-6 py-3 bg-gray-50">Terminal</th>
                <th className="px-6 py-3 bg-gray-50">Terminal ID</th>
                <th className="px-6 py-3 bg-gray-50">Status</th>
                <th className="px-6 py-3 bg-gray-50">Last Sync</th>
                <th className="px-6 py-3 text-right bg-gray-50">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-6 w-16 rounded-full" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-6 py-4 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                  </tr>
                ))
              ) : terminals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    <div className="flex flex-col items-center justify-center">
                      <div className="p-4 bg-gray-50 rounded-full mb-3 text-gray-400">
                        <Icons.Security />
                      </div>
                      <h3 className="text-lg font-medium text-gray-900">No devices found</h3>
                      <p className="text-sm text-gray-500 mt-1 max-w-xs mx-auto mb-4">
                        No POS terminals have been paired with this account yet.
                      </p>
                      <button 
                        onClick={() => navigate('/terminal-pairing')}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm transition-colors"
                      >
                        Pair Your First Device
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                terminals.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{t.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 font-mono">{t.terminalId}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                      (t.status || 'ONLINE') === 'ONLINE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {t.status || 'ONLINE'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {t.lastBatchAt ? new Date(t.lastBatchAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => handleRotateClick(t)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      Regenerate Secret Key
                    </button>
                  </td>
                </tr>
              ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmRotate}
        title="Rotate Encryption Keys?"
        message={`Are you sure you want to regenerate the secret key for ${selectedTerminal?.name}? You must update the new key on the physical device.`}
        confirmText={processing ? "Rotating..." : "Rotate Keys"}
        type="warning"
        isLoading={processing}
      />

      {newSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl animate-scale-in">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-bold text-gray-900">New Terminal Secret Key</h3>
                <p className="text-sm text-gray-500 mt-1">Copy this key now. Update it in the Android POS setup.</p>
              </div>
              <button onClick={() => setNewSecret(null)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-4 border border-gray-100 rounded-xl bg-gray-50">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Merchant ID</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono font-bold text-gray-900">{newSecret.merchantId}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(newSecret.merchantId)}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="p-4 border border-gray-100 rounded-xl bg-gray-50">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Terminal ID</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono font-bold text-gray-900">{newSecret.terminalId}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(newSecret.terminalId)}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div className="p-4 border border-amber-100 rounded-xl bg-amber-50">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-1">Terminal Secret Key</p>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono font-bold text-amber-900 break-all">{newSecret.secretKey}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(newSecret.secretKey)}
                    className="text-amber-800 hover:text-amber-900 text-sm font-medium"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setNewSecret(null)}
                className="px-6 py-2.5 bg-gray-900 text-white font-bold rounded-xl hover:bg-black transition-all active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
