import { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { DATA_RETENTION_POLICY_TEXT } from '../services/moderation';
import { DESIGNATED_OWNER_EMAIL, PRIVACY_POLICY_VERSION } from '../types';

export function PrivacyConsentModal() {
  const { publicProfile, websiteSettings, acceptPrivacyPolicyConsent, signOut } = useAuth();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retentionDays = websiteSettings.dataRetentionDays ?? 365;

  const handleAccept = async () => {
    if (!checked || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await acceptPrivacyPolicyConsent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save privacy consent.');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#F0F2F5] dark:bg-[#0B141A] flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-xl overflow-hidden flex flex-col">
        <div className="px-6 py-5 bg-[#008069] dark:bg-[#162127] border-b border-transparent dark:border-[#222E35] text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight">
              Privacy Notice &amp; Owner Moderation Disclosure
            </h1>
            <p className="text-xs text-white/80">
              Please review and consent before chatting on {websiteSettings.siteName || 'VerdeChat'}
            </p>
          </div>
        </div>

        <div className="p-6 space-y-4 text-xs text-[#54656F] dark:text-[#8696A0] leading-relaxed max-h-[65dvh] overflow-y-auto">
          <p className="text-sm text-[#111B21] dark:text-[#E9EDEF]">
            Welcome, <strong className="font-semibold">{publicProfile?.displayName}</strong> (@
            {publicProfile?.username}). Before entering chats, please review how your conversations
            are protected and moderated:
          </p>

          <div className="p-4 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] space-y-2.5">
            <div className="flex items-center gap-2 font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              <MessageSquare className="w-4 h-4 text-[#008069] dark:text-[#00A884] shrink-0" />
              <span>Authorized Owner Review for Moderation &amp; Safety</span>
            </div>
            <p>{websiteSettings.moderationPolicySummary}</p>
            <p className="text-[11px] text-[#667781] dark:text-[#8696A0]">
              Authorized Owner Account:{' '}
              <span className="font-mono font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                {DESIGNATED_OWNER_EMAIL}
              </span>
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] space-y-2">
            <div className="flex items-center gap-2 font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              <Lock className="w-4 h-4 text-[#008069] dark:text-[#00A884] shrink-0" />
              <span>Privacy Safeguards &amp; Immutable Audit Trail</span>
            </div>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                Ordinary users can never access, list, or view another user&apos;s private
                conversations—enforced strictly by Firestore Security Rules and backend verification.
              </li>
              <li>
                Every time the verified owner opens a conversation history or reported message for
                safety review, an immutable security audit log entry is permanently recorded.
              </li>
            </ul>
          </div>

          <div className="p-4 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] space-y-2">
            <div className="flex items-center gap-2 font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              <Clock className="w-4 h-4 text-[#008069] dark:text-[#00A884] shrink-0" />
              <span>Data Retention Policy ({retentionDays} days)</span>
            </div>
            <p>{DATA_RETENTION_POLICY_TEXT}</p>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[#667781] dark:text-[#8696A0]">
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span>Policy Version: {PRIVACY_POLICY_VERSION}</span>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[#00A884]/8 border border-[#00A884]/25 text-xs text-[#111B21] dark:text-[#E9EDEF] cursor-pointer">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 rounded accent-[#008069] w-4 h-4 shrink-0"
            />
            <span>
              I acknowledge and consent that authorized owner accounts ({DESIGNATED_OWNER_EMAIL})
              may review conversations and reported messages for moderation and platform safety, with
              every access audit-logged under the {retentionDays}-day data retention policy.
            </span>
          </label>
        </div>

        <div className="px-6 py-4 bg-[#F8FAFB] dark:bg-[#162127] border-t border-[#E9EDEF] dark:border-[#222E35] flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-[#54656F] dark:text-[#AEBAC1] hover:bg-[#E9EDEF] dark:hover:bg-[#202C33] cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>

          <button
            type="button"
            disabled={!checked || submitting}
            onClick={handleAccept}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-50 text-white text-xs sm:text-sm font-semibold cursor-pointer transition-colors"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            <span>Accept &amp; Start Chatting</span>
          </button>
        </div>
      </div>
    </div>
  );
}
