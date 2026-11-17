import { CheckCircle2, Clock, Lock, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { DATA_RETENTION_POLICY_TEXT } from '../services/moderation';
import { DESIGNATED_OWNER_EMAIL, PRIVACY_POLICY_VERSION } from '../types';

interface ModerationPolicyModalProps {
  onClose: () => void;
}

export function ModerationPolicyModal({ onClose }: ModerationPolicyModalProps) {
  const { websiteSettings, privacyConsent } = useAuth();
  const retentionDays = websiteSettings.dataRetentionDays ?? 365;
  const consentedAtText =
    privacyConsent?.consentedAt && typeof privacyConsent.consentedAt.toDate === 'function'
      ? privacyConsent.consentedAt.toDate().toLocaleString()
      : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Privacy and moderation policy"
    >
      <div className="w-full max-w-lg bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90dvh]">
        <div className="px-5 py-4 border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#008069] dark:text-[#00A884]" />
            <h2 className="text-base font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              Privacy, Moderation &amp; Data Retention Policy
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close policy dialog"
            className="min-w-[36px] min-h-[36px] rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] flex items-center justify-center text-[#54656F] dark:text-[#8696A0] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs text-[#54656F] dark:text-[#8696A0] leading-relaxed overflow-y-auto">
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#008069] dark:text-[#00A884]">
              Owner Moderation Disclosure
            </h3>
            <p className="text-sm text-[#111B21] dark:text-[#E9EDEF]">
              {websiteSettings.moderationPolicySummary}
            </p>
            <p className="text-[11px]">
              Designated Authorized Owner:{' '}
              <span className="font-mono font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                {DESIGNATED_OWNER_EMAIL}
              </span>
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] space-y-2">
            <div className="flex items-center gap-2 font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              <Lock className="w-3.5 h-3.5 text-[#008069] dark:text-[#00A884]" />
              <span>Technical Security &amp; Audit Controls</span>
            </div>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                Direct chats and group chats are strictly isolated from ordinary users in Firestore Security Rules—other users can never access your conversations.
              </li>
              <li>
                Owner Dashboard access and conversation monitoring APIs verify Firebase Auth UID, email verification, and the locked owner record on the backend.
              </li>
              <li>
                Every time the authorized owner reviews a conversation history or reported message, an immutable audit log entry is permanently written before content is returned.
              </li>
            </ul>
          </div>

          <div className="p-3.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              <Clock className="w-3.5 h-3.5 text-[#008069] dark:text-[#00A884]" />
              <span>Data Retention Policy ({retentionDays} days)</span>
            </div>
            <p>{DATA_RETENTION_POLICY_TEXT}</p>
          </div>

          {privacyConsent?.consented && (
            <div className="p-3 rounded-xl bg-[#00A884]/10 border border-[#00A884]/25 flex items-start gap-2 text-[#008069] dark:text-[#00A884]">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">
                  Consent recorded ({privacyConsent.policyVersion || PRIVACY_POLICY_VERSION})
                </div>
                {consentedAtText && (
                  <div className="text-[11px] opacity-90">Accepted on {consentedAtText}</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 bg-[#F8FAFB] dark:bg-[#162127] border-t border-[#E9EDEF] dark:border-[#222E35] flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
