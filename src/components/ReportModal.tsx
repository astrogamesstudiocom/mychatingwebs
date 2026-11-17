import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, Loader2, Shield, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { submitModerationReport } from '../services/moderation';
import type { ChatCollection, ReportType } from '../types';

interface ReportModalProps {
  reportType: ReportType;
  reportedUid: string;
  reportedName: string;
  chatId?: string;
  chatCollection?: '' | ChatCollection;
  messageId?: string;
  messageTextSnippet?: string;
  surroundingMessages?: string[];
  onClose: () => void;
}

const REPORT_REASONS = [
  'Harassment or bullying',
  'Spam or unwanted solicitation',
  'Hate speech or abusive content',
  'Impersonation or scam',
  'Inappropriate media or threat',
  'Other community rule violation',
];

export function ReportModal({
  reportType,
  reportedUid,
  reportedName,
  chatId = '',
  chatCollection = '',
  messageId = '',
  messageTextSnippet = '',
  surroundingMessages = [],
  onClose,
}: ReportModalProps) {
  const { publicProfile, websiteSettings } = useAuth();
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [includeContext, setIncludeContext] = useState(reportType === 'message');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicProfile || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitModerationReport({
        reportType,
        reportedUid,
        reportedName,
        reporterUid: publicProfile.uid,
        reporterName: publicProfile.displayName,
        chatId,
        chatCollection,
        messageId,
        messageTextSnippet,
        contextMessages: includeContext ? surroundingMessages : [],
        reason,
        details,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit report right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Report user or message"
    >
      <div className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90dvh]">
        <div className="px-5 py-4 border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h2 className="text-base font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              {reportType === 'message' ? 'Report Message' : 'Report User'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report dialog"
            className="min-w-[36px] min-h-[36px] rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] flex items-center justify-center text-[#54656F] dark:text-[#8696A0] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {submitted ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                Report Submitted
              </h3>
              <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1.5 leading-relaxed">
                Thank you for helping keep {websiteSettings.siteName} safe. Only the reported details you submitted can be reviewed by an authorized moderator, and any review is logged for accountability.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-sm font-semibold cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="p-3 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] text-xs text-[#54656F] dark:text-[#8696A0] flex items-start gap-2.5">
              <Shield className="w-4 h-4 text-[#008069] dark:text-[#00A884] shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <strong className="text-[#111B21] dark:text-[#E9EDEF]">Privacy Notice:</strong>{' '}
                Your private chats stay private. Moderators can only view the specific message or context you explicitly attach to this report.
              </div>
            </div>

            <div>
              <div className="text-xs text-[#667781] dark:text-[#8696A0]">Reporting</div>
              <div className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] mt-0.5">
                {reportedName}
              </div>
              {messageTextSnippet && (
                <div className="mt-2 p-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs text-[#111B21] dark:text-[#E9EDEF] line-clamp-3">
                  &ldquo;{messageTextSnippet}&rdquo;
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1.5">
                Reason
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
              >
                {REPORT_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1.5">
                Additional Context (optional)
              </label>
              <textarea
                rows={3}
                maxLength={1000}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Describe what happened so moderators can act accurately..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none resize-none"
              />
            </div>

            {surroundingMessages.length > 0 && (
              <label className="flex items-start gap-2.5 text-xs text-[#54656F] dark:text-[#8696A0] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeContext}
                  onChange={(e) => setIncludeContext(e.target.checked)}
                  className="mt-0.5 rounded accent-[#00A884] w-4 h-4 shrink-0"
                />
                <span>
                  <span className="inline-flex items-center gap-1 font-medium text-[#111B21] dark:text-[#E9EDEF]">
                    <Eye className="w-3.5 h-3.5" />
                    Include up to {surroundingMessages.length} surrounding messages
                  </span>
                  <span className="block text-[11px] mt-0.5">
                    Helps moderators verify context. Otherwise only this single reported item is sent.
                  </span>
                </span>
              </label>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#54656F] dark:text-[#8696A0] hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Submit Report</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
