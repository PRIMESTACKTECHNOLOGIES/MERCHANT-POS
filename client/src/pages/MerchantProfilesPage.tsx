import { useState, useEffect } from "react";
import { useToast } from "../components/ui/toastContext";
import { TableSkeleton } from "../components/ui/Skeleton";
import { deleteMerchantProfile, fetchMerchantProfiles } from "../lib/api";
import type { MerchantProfile } from "../lib/api";

// --- Icons ---
const Icons = {
  Store: () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9l1.5-5h15L21 9M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 20v-6h6v6" />
    </svg>
  ),
  Trash: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  Lock: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  Refresh: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  X: () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
};

const formatMoney = (balance: number, currency: string) =>
  `${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export const MerchantProfilesPage = () => {
  const [profiles, setProfiles] = useState<MerchantProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MerchantProfile | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const data = await fetchMerchantProfiles();
      setProfiles(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load merchant profiles";
      setLoadError(message);
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  };

  const openDelete = (profile: MerchantProfile) => {
    setDeleteTarget(profile);
    setConfirmName("");
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const result = await deleteMerchantProfile(deleteTarget.merchantId, confirmName);
      const removedTerminals = Array.isArray(result?.removedTerminals) ? result.removedTerminals.length : 0;
      showToast(
        `${deleteTarget.merchantName} deleted (${removedTerminals} terminal(s), ${result?.removedWalletCount ?? 0} wallet(s) removed)`,
        "success"
      );
      setDeleteTarget(null);
      setConfirmName("");
      loadProfiles();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to delete merchant profile", "error");
    } finally {
      setDeleting(false);
    }
  };

  const canConfirm =
    !!deleteTarget &&
    confirmName.trim().toLowerCase() === deleteTarget.merchantName.trim().toLowerCase();

  return (
    <div className="p-8 max-w-7xl mx-auto animate-fade-in">

      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Merchant Profiles</h1>
          <p className="text-gray-500 mt-1">Every merchant account on this processor, with its terminals and wallet balances</p>
        </div>
        <button
          onClick={loadProfiles}
          className="flex items-center gap-2 border border-gray-200 bg-white px-4 py-2 rounded-lg font-medium text-gray-700 hover:bg-gray-50 shadow-sm transition-all active:scale-[0.98]"
        >
          <Icons.Refresh />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total Profiles</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{profiles.length}</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Registered Terminals</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {profiles.reduce((sum, p) => sum + p.terminalCount, 0)}
          </p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Deletable</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">
            {profiles.filter((p) => p.deletable).length}
          </p>
        </div>
      </div>

      {loadError && !loading && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800 flex items-center justify-between gap-4">
          <span>Unable to load merchant profiles: {loadError}</span>
          <button onClick={loadProfiles} className="rounded-lg bg-red-600 px-3 py-2 font-semibold text-white hover:bg-red-700">Retry</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <TableSkeleton rows={4} />
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Merchant</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Terminals</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Wallet Balances</th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {profiles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No merchant profiles found.
                  </td>
                </tr>
              ) : (
                profiles.map((profile) => (
                  <tr key={profile.merchantId} className="hover:bg-gray-50 transition-colors align-top">
                    <td className="px-6 py-4">
                      <div className="flex items-start">
                        <div className="flex-shrink-0 h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500">
                          <Icons.Store />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">{profile.merchantName}</div>
                          <div className="text-sm text-gray-500">ID: {profile.merchantId}</div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-gray-100 text-gray-600">
                              {profile.testMode ? "Test Mode" : "Live"}
                            </span>
                            {!profile.deletable && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                                <Icons.Lock />
                                Locked
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      <div>{profile.supportEmail || "—"}</div>
                      <div className="text-xs text-gray-400 mt-1">{profile.phone || "no phone"}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{profile.terminalCount}</td>
                    <td className="px-6 py-4 text-sm">
                      {profile.wallets.length === 0 ? (
                        <span className="text-gray-400">No wallets</span>
                      ) : (
                        <div className="space-y-1">
                          {profile.wallets.map((w) => (
                            <div key={w.currency} className="flex items-center gap-2">
                              <span className="inline-block min-w-[42px] text-xs font-bold text-gray-500">{w.currency}</span>
                              <span className={`font-mono ${w.balance === 0 ? "text-gray-400" : "text-gray-900 font-semibold"}`}>
                                {formatMoney(w.balance, w.currency)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium">
                      {profile.deletable ? (
                        <button
                          onClick={() => openDelete(profile)}
                          className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-900"
                        >
                          <Icons.Trash />
                          Delete
                        </button>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className="inline-flex items-center gap-1.5 text-gray-400 cursor-not-allowed"
                            title={`Delete blocked: ${profile.deleteBlockers.join("; ")}`}
                          >
                            <Icons.Lock />
                            Delete
                          </span>
                          <span className="text-[11px] text-amber-700 max-w-[260px] text-right leading-snug">
                            {profile.deleteBlockers.join("; ")}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl animate-scale-in">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Delete Merchant Profile</h3>
                <p className="text-sm text-gray-500 mt-1">
                  <span className="font-mono font-bold text-red-600">{deleteTarget.merchantId}</span> · {deleteTarget.merchantName}
                </p>
              </div>
              <button onClick={() => setDeleteTarget(null)} className="text-gray-400 hover:text-gray-600">
                <Icons.X />
              </button>
            </div>

            <div className="p-4 bg-red-50 rounded-xl border border-red-100 mb-6">
              <p className="text-sm font-bold text-red-900">This cannot be undone.</p>
              <p className="text-xs text-red-700 mt-1">
                Deleting this profile also removes its {deleteTarget.terminalCount} terminal(s) and{" "}
                {deleteTarget.wallets.length} wallet(s) from this processor.
              </p>
            </div>

            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
              Type "{deleteTarget.merchantName}" to confirm
            </label>
            <input
              type="text"
              autoFocus
              className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all"
              placeholder={deleteTarget.merchantName}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canConfirm && !deleting && handleDelete()}
            />

            <div className="flex justify-end gap-3 mt-8">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-5 py-2.5 text-gray-600 font-semibold hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={!canConfirm || deleting}
                className="px-6 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg shadow-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
              >
                {deleting ? "Deleting..." : "Delete Profile"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
