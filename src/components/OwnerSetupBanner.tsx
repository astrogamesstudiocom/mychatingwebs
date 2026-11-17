import { useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export function OwnerSetupBanner() {
  const { firebaseUser, ownerSetupRequired, claimSuperAdminOwnership } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!ownerSetupRequired || !firebaseUser || done) {
    return null;
  }

  const handleInitialize = async () => {
    setBusy(true);
    setError(null);
    try {
      await claimSuperAdminOwnership();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize Super Admin ownership.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="One-time Super Admin ownership setup"
    >
      <div className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-6 space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center">
            <KeyRound className="w-6 h-6" />
          </div>

          <div>
            <h2 className="text-lg font-bold text-[#111B21] dark:text-[#E9EDEF]">
              Initialize Super Admin Ownership
            </h2>
            <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1.5 leading-relaxed">
              Your verified website owner account is recognized, and no Super Admin UID has been locked yet. Complete this one-time setup to bind full administrative control exclusively to your Firebase Auth UID.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] space-y-1.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#667781] dark:text-[#8696A0]">Owner Email</span>
              <span className="font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                {firebaseUser.email}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#667781] dark:text-[#8696A0]">Firebase UID</span>
              <span className="font-mono text-[11px] text-[#111B21] dark:text-[#E9EDEF] truncate max-w-[200px]">
                {firebaseUser.uid}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[#008069] dark:text-[#00A884] pt-1">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>Email verified · Immutable owner lock</span>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={handleInitialize}
            className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{busy ? 'Locking Ownership...' : 'Activate Super Admin Control'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
