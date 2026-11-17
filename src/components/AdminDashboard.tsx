import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Ban,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Filter,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  DESIGNATED_OWNER_EMAIL,
  type AccountModerationStatus,
  type OwnerConversationSummary,
  type OwnerDashboardPayload,
  type OwnerMessageRecord,
  type OwnerReportRow,
  type OwnerUserRow,
  type ReportStatus,
} from '../types';
import {
  accessOwnerConversation,
  accessReportViaServer,
  DATA_RETENTION_POLICY_TEXT,
  DEFAULT_MODERATION_POLICY,
  fetchOwnerDashboard,
  moderateUserViaServer,
  resolveReportViaServer,
  saveWebsiteSettingsViaServer,
  verifyOwnerWithServer,
} from '../services/moderation';
import { Avatar } from './Avatar';

interface AdminDashboardProps {
  onClose: () => void;
}

type OwnerTab =
  | 'overview'
  | 'conversations'
  | 'users'
  | 'reports'
  | 'logs'
  | 'settings';

function formatIsoDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatIsoDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getConversationDisplayTitle(c: OwnerConversationSummary): string {
  if (c.type === 'group') {
    return c.title || 'Group Chat';
  }
  if (c.participants.length >= 2) {
    return `${c.participants[0].displayName} ↔ ${c.participants[1].displayName}`;
  }
  if (c.participants.length === 1) {
    return c.participants[0].displayName;
  }
  return c.id;
}

export function AdminDashboard({ onClose }: AdminDashboardProps) {
  const { firebaseUser, isSuperAdmin } = useAuth();

  const [activeTab, setActiveTab] = useState<OwnerTab>('overview');
  const [verifying, setVerifying] = useState(true);
  const [serverVerified, setServerVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [loadingData, setLoadingData] = useState(false);
  const [dashboard, setDashboard] = useState<OwnerDashboardPayload | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Conversations filters & audit-logged thread viewer
  const [convSearch, setConvSearch] = useState('');
  const [convUserUid, setConvUserUid] = useState('all');
  const [convTypeFilter, setConvTypeFilter] = useState<'all' | 'direct' | 'group'>('all');
  const [convDateFrom, setConvDateFrom] = useState('');
  const [convDateTo, setConvDateTo] = useState('');

  const [pendingConvTarget, setPendingConvTarget] = useState<OwnerConversationSummary | null>(
    null
  );
  const [convAccessReason, setConvAccessReason] = useState('');
  const [convLoading, setConvLoading] = useState(false);
  const [openedConversation, setOpenedConversation] = useState<{
    conversation: OwnerConversationSummary;
    messages: OwnerMessageRecord[];
    auditLogId: string;
    accessedAt: string;
    reason: string;
  } | null>(null);
  const [threadMessageFilter, setThreadMessageFilter] = useState('');

  // Users filters, profile viewer, and moderation modal
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState<
    'all' | 'online' | 'offline' | 'restricted' | 'consented'
  >('all');
  const [inspectingUser, setInspectingUser] = useState<OwnerUserRow | null>(null);
  const [moderatingUser, setModeratingUser] = useState<OwnerUserRow | null>(null);
  const [modStatus, setModStatus] = useState<AccountModerationStatus>('suspended');
  const [modReason, setModReason] = useState('');
  const [modSubmitting, setModSubmitting] = useState(false);

  // Moderation reports state
  const [reportFilter, setReportFilter] = useState<'all' | ReportStatus>('all');
  const [reviewingReport, setReviewingReport] = useState<OwnerReportRow | null>(null);
  const [reportAccessReason, setReportAccessReason] = useState('');
  const [reportResolutionNote, setReportResolutionNote] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  // Audit log filters
  const [logSearch, setLogSearch] = useState('');
  const [logCategory, setLogCategory] = useState<'all' | 'access' | 'moderation' | 'settings'>(
    'all'
  );

  // Website & Privacy settings draft
  const [settingsDraft, setSettingsDraft] = useState({
    siteName: 'VerdeChat',
    welcomeNotice: '',
    moderationPolicySummary: DEFAULT_MODERATION_POLICY,
    allowNewRegistrations: true,
    allowGroupCreation: true,
    allowVoiceVideoCalls: true,
    allowMediaUploads: true,
    maintenanceMode: false,
    ownerMonitoringEnabled: true,
    allowPrivateContextReview: true,
    dataRetentionDays: 365,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  const showToast = (msg: string) => {
    setActionError(null);
    setActionFeedback(msg);
    window.setTimeout(() => setActionFeedback(null), 4500);
  };

  const loadDashboard = useCallback(async () => {
    if (!firebaseUser) return;
    setLoadingData(true);
    setActionError(null);
    try {
      const payload = await fetchOwnerDashboard(firebaseUser);
      setDashboard(payload);
      setSettingsDraft({
        siteName: payload.settings.siteName,
        welcomeNotice: payload.settings.welcomeNotice,
        moderationPolicySummary: payload.settings.moderationPolicySummary,
        allowNewRegistrations: payload.settings.allowNewRegistrations,
        allowGroupCreation: payload.settings.allowGroupCreation,
        allowVoiceVideoCalls: payload.settings.allowVoiceVideoCalls,
        allowMediaUploads: payload.settings.allowMediaUploads,
        maintenanceMode: payload.settings.maintenanceMode,
        ownerMonitoringEnabled: payload.settings.ownerMonitoringEnabled,
        allowPrivateContextReview: payload.settings.allowPrivateContextReview,
        dataRetentionDays: payload.settings.dataRetentionDays,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load owner dashboard.');
    } finally {
      setLoadingData(false);
    }
  }, [firebaseUser]);

  // Backend-enforced Owner verification on mount
  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!firebaseUser || !isSuperAdmin) {
        if (active) {
          setServerVerified(false);
          setVerifying(false);
          setVerifyError(`Owner access is strictly restricted to ${DESIGNATED_OWNER_EMAIL}.`);
        }
        return;
      }

      setVerifying(true);
      setVerifyError(null);
      const res = await verifyOwnerWithServer(firebaseUser);
      if (!active) return;

      if (!res.authorized || !res.isSuperAdmin) {
        setServerVerified(false);
        setVerifying(false);
        setVerifyError('Backend authorization denied. Only the verified Website Owner can open this console.');
        return;
      }

      setServerVerified(true);
      setVerifying(false);
      await loadDashboard();
    };

    void run();
    return () => {
      active = false;
    };
  }, [firebaseUser, isSuperAdmin, loadDashboard]);

  const filteredConversations = useMemo(() => {
    if (!dashboard) return [];
    const q = convSearch.trim().toLowerCase().replace(/^@/, '');
    const fromMs = convDateFrom ? new Date(`${convDateFrom}T00:00:00`).getTime() : 0;
    const toMs = convDateTo ? new Date(`${convDateTo}T23:59:59.999`).getTime() : 0;

    return dashboard.conversations.filter((c) => {
      if (convTypeFilter !== 'all' && c.type !== convTypeFilter) return false;
      if (convUserUid !== 'all' && !c.participantIds.includes(convUserUid)) return false;

      if (fromMs || toMs) {
        const refIso = c.lastMessageAt || c.createdAt;
        const ms = refIso ? new Date(refIso).getTime() : 0;
        if (fromMs && (!ms || ms < fromMs)) return false;
        if (toMs && (!ms || ms > toMs)) return false;
      }

      if (!q) return true;
      const participantHit = c.participants.some(
        (p) =>
          p.displayName.toLowerCase().includes(q) ||
          p.username.toLowerCase().includes(q) ||
          p.uid.toLowerCase().includes(q)
      );
      return (
        participantHit ||
        c.title.toLowerCase().includes(q) ||
        c.lastMessageText.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      );
    });
  }, [dashboard, convSearch, convUserUid, convTypeFilter, convDateFrom, convDateTo]);

  const filteredThreadMessages = useMemo(() => {
    if (!openedConversation) return [];
    const q = threadMessageFilter.trim().toLowerCase();
    if (!q) return openedConversation.messages;
    return openedConversation.messages.filter(
      (m) =>
        m.text.toLowerCase().includes(q) ||
        m.senderName.toLowerCase().includes(q) ||
        m.senderUsername.toLowerCase().includes(q) ||
        m.mediaName.toLowerCase().includes(q)
    );
  }, [openedConversation, threadMessageFilter]);

  const filteredUsers = useMemo(() => {
    if (!dashboard) return [];
    const q = userSearch.trim().toLowerCase().replace(/^@/, '');
    return dashboard.users.filter((u) => {
      if (userFilter === 'online' && !u.isOnline) return false;
      if (userFilter === 'offline' && u.isOnline) return false;
      if (userFilter === 'restricted' && u.moderationStatus === 'active') return false;
      if (userFilter === 'consented' && !u.consented) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q)
      );
    });
  }, [dashboard, userSearch, userFilter]);

  const filteredReports = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.reports.filter((r) =>
      reportFilter === 'all' ? true : r.status === reportFilter
    );
  }, [dashboard, reportFilter]);

  const filteredLogs = useMemo(() => {
    if (!dashboard) return [];
    const q = logSearch.trim().toLowerCase();
    return dashboard.logs.filter((l) => {
      if (
        logCategory === 'access' &&
        !['owner_conversation_accessed', 'report_message_accessed', 'report_context_reviewed'].includes(
          l.action
        )
      ) {
        return false;
      }
      if (
        logCategory === 'moderation' &&
        !l.action.startsWith('account_') &&
        !l.action.startsWith('report_')
      ) {
        return false;
      }
      if (
        logCategory === 'settings' &&
        !['website_settings_updated', 'privacy_consent_accepted', 'super_admin_initialized'].includes(
          l.action
        )
      ) {
        return false;
      }

      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        l.actorName.toLowerCase().includes(q) ||
        l.targetLabel.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q)
      );
    });
  }, [dashboard, logSearch, logCategory]);

  const maxDailyRegCount = useMemo(() => {
    const arr = dashboard?.stats.dailyRegistrations || [];
    return Math.max(1, ...arr.map((b) => b.count));
  }, [dashboard]);

  const handleOpenConversationWithAudit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !pendingConvTarget || convLoading) return;
    const cleanReason = convAccessReason.trim();
    if (cleanReason.length < 3) {
      setActionError('Please enter a moderation/safety reason (at least 3 characters).');
      return;
    }

    setConvLoading(true);
    setActionError(null);
    try {
      const result = await accessOwnerConversation(firebaseUser, {
        collection: pendingConvTarget.collection,
        chatId: pendingConvTarget.id,
        reason: cleanReason,
      });

      setOpenedConversation({
        conversation: result.conversation,
        messages: result.messages,
        auditLogId: result.auditLogId,
        accessedAt: result.accessedAt,
        reason: cleanReason,
      });
      setPendingConvTarget(null);
      setConvAccessReason('');
      setThreadMessageFilter('');
      showToast(`Audit log ${result.auditLogId} recorded. Loaded ${result.messages.length} messages.`);
      void loadDashboard();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to audit-log and open conversation.'
      );
    } finally {
      setConvLoading(false);
    }
  };

  const handleModerateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !moderatingUser || modSubmitting) return;
    setModSubmitting(true);
    setActionError(null);
    try {
      await moderateUserViaServer(firebaseUser, {
        targetUid: moderatingUser.uid,
        status: modStatus,
        reason: modReason,
      });
      setModeratingUser(null);
      setModReason('');
      showToast(`Updated @${moderatingUser.username} status to ${modStatus}.`);
      await loadDashboard();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to moderate user account.');
    } finally {
      setModSubmitting(false);
    }
  };

  const handleUnlockReport = async (report: OwnerReportRow) => {
    if (!firebaseUser || reportSubmitting) return;
    if (reportAccessReason.trim().length < 3) {
      setActionError('Please enter a moderation reason before viewing reported content.');
      return;
    }
    setReportSubmitting(true);
    setActionError(null);
    try {
      const res = await accessReportViaServer(firebaseUser, {
        reportId: report.id,
        reason: reportAccessReason.trim(),
      });
      setReviewingReport(res.report);
      setReportAccessReason('');
      showToast(`Report access audit-logged (${res.auditLogId}). User notice recorded.`);
      await loadDashboard();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to open reported message.');
    } finally {
      setReportSubmitting(false);
    }
  };

  const handleResolveReport = async (
    report: OwnerReportRow,
    status: Extract<ReportStatus, 'resolved' | 'dismissed'>
  ) => {
    if (!firebaseUser || reportSubmitting) return;
    setReportSubmitting(true);
    setActionError(null);
    try {
      await resolveReportViaServer(firebaseUser, {
        reportId: report.id,
        status,
        resolutionNote: reportResolutionNote.trim() || `Marked as ${status}`,
      });
      setReviewingReport(null);
      setReportResolutionNote('');
      showToast(`Report marked as ${status}.`);
      await loadDashboard();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to resolve report.');
    } finally {
      setReportSubmitting(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || savingSettings) return;
    setSavingSettings(true);
    setActionError(null);
    try {
      await saveWebsiteSettingsViaServer(firebaseUser, settingsDraft);
      showToast('Privacy & website settings saved and logged.');
      await loadDashboard();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const applyQuickDateFilter = (preset: 'all' | 'today' | '7d' | '30d') => {
    if (preset === 'all') {
      setConvDateFrom('');
      setConvDateTo('');
      return;
    }
    const now = new Date();
    const toStr = now.toISOString().slice(0, 10);
    const daysBack = preset === 'today' ? 0 : preset === '7d' ? 6 : 29;
    const fromDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    setConvDateFrom(fromDate.toISOString().slice(0, 10));
    setConvDateTo(toStr);
  };

  if (verifying) {
    return (
      <div className="min-h-dvh bg-[#F0F2F5] dark:bg-[#0B141A] flex flex-col items-center justify-center gap-3 p-4">
        <div className="w-12 h-12 rounded-2xl bg-[#008069] text-white flex items-center justify-center">
          <Shield className="w-6 h-6" />
        </div>
        <Loader2 className="w-5 h-5 animate-spin text-[#008069] dark:text-[#00A884]" />
        <p className="text-xs font-medium text-[#667781] dark:text-[#8696A0]">
          Verifying Website Owner credentials on backend...
        </p>
      </div>
    );
  }

  if (!serverVerified || !isSuperAdmin) {
    return (
      <div className="min-h-dvh bg-[#F0F2F5] dark:bg-[#0B141A] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl p-6 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-red-500/12 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#111B21] dark:text-[#E9EDEF]">
              Owner Access Denied
            </h1>
            <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1.5 leading-relaxed">
              {verifyError || `Only the verified website owner (${DESIGNATED_OWNER_EMAIL}) can access this dashboard.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Chats</span>
          </button>
        </div>
      </div>
    );
  }

  const navItems: Array<{ id: OwnerTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'overview', label: 'Overview', icon: <Activity className="w-4 h-4" /> },
    {
      id: 'conversations',
      label: 'All Conversations',
      icon: <MessageSquare className="w-4 h-4" />,
      badge: dashboard?.stats.totalConversations,
    },
    {
      id: 'users',
      label: 'Users',
      icon: <Users className="w-4 h-4" />,
      badge: dashboard?.stats.totalUsers,
    },
    {
      id: 'reports',
      label: 'Moderation',
      icon: <AlertTriangle className="w-4 h-4" />,
      badge: dashboard?.stats.openReports,
    },
    { id: 'logs', label: 'Audit Logs', icon: <FileText className="w-4 h-4" /> },
    { id: 'settings', label: 'Privacy & Settings', icon: <SettingsIcon className="w-4 h-4" /> },
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-[#F0F2F5] dark:bg-[#0B141A] flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Owner Chat Monitoring and Management Dashboard"
    >
      {/* Top Bar */}
      <header className="h-[62px] shrink-0 px-4 sm:px-6 bg-white dark:bg-[#111B21] border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] hover:bg-[#E9EDEF] dark:hover:bg-[#2A3942] text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to Chat</span>
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-[#111B21] dark:text-[#E9EDEF] truncate">
                VerdeChat Owner Monitoring Console
              </h1>
              <p className="text-[11px] text-[#667781] dark:text-[#8696A0] truncate">
                Verified Owner: {dashboard?.owner.email || firebaseUser?.email} · Backend Token Verified
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={loadingData}
            onClick={() => void loadDashboard()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] hover:bg-[#E9EDEF] dark:hover:bg-[#2A3942] text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close owner console"
            className="min-w-[38px] min-h-[38px] rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] flex items-center justify-center text-[#54656F] dark:text-[#8696A0] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        <nav className="md:w-64 shrink-0 bg-white dark:bg-[#111B21] border-b md:border-b-0 md:border-r border-[#E9EDEF] dark:border-[#222E35] p-2 sm:p-3 flex md:flex-col gap-1 overflow-x-auto">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 whitespace-nowrap cursor-pointer transition-colors ${
                  active
                    ? 'bg-[#00A884]/12 text-[#008069] dark:text-[#00A884]'
                    : 'text-[#54656F] dark:text-[#AEBAC1] hover:bg-[#F5F6F6] dark:hover:bg-[#202C33]'
                }`}
              >
                <span className="flex items-center gap-2">
                  {item.icon}
                  <span>{item.label}</span>
                </span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`px-1.5 py-0.5 rounded font-mono tabular-nums text-[11px] ${
                      item.id === 'reports'
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        : 'bg-[#F0F2F5] dark:bg-[#202C33] text-[#54656F] dark:text-[#AEBAC1]'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-6xl mx-auto space-y-6">
            {actionFeedback && (
              <div className="p-3 rounded-xl bg-[#00A884]/12 border border-[#00A884]/25 text-xs text-[#008069] dark:text-[#00A884] flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {actionFeedback}
                </span>
                <button type="button" onClick={() => setActionFeedback(null)} className="cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {actionError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  {actionError}
                </span>
                <button type="button" onClick={() => setActionError(null)} className="cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {loadingData && !dashboard && (
              <div className="py-16 flex flex-col items-center justify-center gap-3 text-xs text-[#667781] dark:text-[#8696A0]">
                <Loader2 className="w-6 h-6 animate-spin text-[#008069] dark:text-[#00A884]" />
                <span>Loading real-time Firebase analytics and conversations...</span>
              </div>
            )}

            {/* 1. OVERVIEW TAB */}
            {activeTab === 'overview' && dashboard && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="p-4 rounded-2xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35]">
                    <div className="text-xs text-[#667781] dark:text-[#8696A0]">
                      Total Registered Users
                    </div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-[#111B21] dark:text-[#E9EDEF] mt-1">
                      {dashboard.stats.totalUsers}
                    </div>
                    <div className="text-[11px] text-[#667781] dark:text-[#8696A0] mt-0.5">
                      {dashboard.stats.consentedUsers} consented to privacy policy
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35]">
                    <div className="text-xs text-[#667781] dark:text-[#8696A0]">Active Users</div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-[#008069] dark:text-[#00A884] mt-1">
                      {dashboard.stats.activeOnlineUsers}
                    </div>
                    <div className="text-[11px] text-[#667781] dark:text-[#8696A0] mt-0.5">
                      {dashboard.stats.activeLast24hUsers} active in last 24h
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35]">
                    <div className="text-xs text-[#667781] dark:text-[#8696A0]">
                      Total Conversations
                    </div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-[#111B21] dark:text-[#E9EDEF] mt-1">
                      {dashboard.stats.totalConversations}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-[#667781] dark:text-[#8696A0] mt-0.5">
                      {dashboard.stats.totalDirectChats} direct · {dashboard.stats.totalGroupChats} groups
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35]">
                    <div className="text-xs text-[#667781] dark:text-[#8696A0]">
                      Total Messages
                    </div>
                    <div className="text-2xl font-bold font-mono tabular-nums text-[#111B21] dark:text-[#E9EDEF] mt-1">
                      {dashboard.stats.totalMessages}
                    </div>
                    <div className="text-[11px] text-[#667781] dark:text-[#8696A0] mt-0.5">
                      All existing &amp; new Firestore messages
                    </div>
                  </div>
                </div>

                {/* New User Registrations Breakdown + 14-day Trend */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  <div className="lg:col-span-4 p-4 rounded-2xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] space-y-3">
                    <h2 className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                      New User Registrations
                    </h2>
                    <div className="space-y-2.5 text-xs">
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127]">
                        <span className="text-[#667781] dark:text-[#8696A0]">Last 24 hours</span>
                        <span className="font-mono font-bold text-[#111B21] dark:text-[#E9EDEF]">
                          {dashboard.stats.newUsers24h}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127]">
                        <span className="text-[#667781] dark:text-[#8696A0]">Last 7 days</span>
                        <span className="font-mono font-bold text-[#111B21] dark:text-[#E9EDEF]">
                          {dashboard.stats.newUsers7d}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127]">
                        <span className="text-[#667781] dark:text-[#8696A0]">Last 30 days</span>
                        <span className="font-mono font-bold text-[#111B21] dark:text-[#E9EDEF]">
                          {dashboard.stats.newUsers30d}
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-500/10">
                        <span className="text-amber-700 dark:text-amber-300 font-medium">
                          Open Moderation Reports
                        </span>
                        <span className="font-mono font-bold text-amber-700 dark:text-amber-300">
                          {dashboard.stats.openReports}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-8 p-4 rounded-2xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                        14-Day Registration Activity (Real Data)
                      </h2>
                      <span className="text-[11px] text-[#667781] dark:text-[#8696A0]">
                        Source: Firebase users collection
                      </span>
                    </div>
                    <div className="h-40 flex items-end gap-1.5 pt-4">
                      {dashboard.stats.dailyRegistrations.map((bucket) => {
                        const pct = Math.round((bucket.count / maxDailyRegCount) * 100);
                        return (
                          <div
                            key={bucket.date}
                            className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0 h-full"
                            title={`${bucket.label}: ${bucket.count} registrations`}
                          >
                            <span className="text-[10px] font-mono tabular-nums text-[#667781] dark:text-[#8696A0]">
                              {bucket.count > 0 ? bucket.count : ''}
                            </span>
                            <div className="w-full flex-1 flex items-end">
                              <div
                                className="w-full rounded-t-md bg-[#008069] dark:bg-[#00A884] transition-all"
                                style={{ height: `${Math.max(bucket.count > 0 ? 14 : 4, pct)}%`, opacity: bucket.count > 0 ? 1 : 0.2 }}
                              />
                            </div>
                            <span className="text-[9px] text-[#667781] dark:text-[#8696A0] truncate max-w-full">
                              {bucket.label.split(' ')[1]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Transparency & Privacy Notice Card */}
                <div className="p-4 rounded-2xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] flex items-start gap-3">
                  <Lock className="w-5 h-5 text-[#008069] dark:text-[#00A884] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                      Transparent Moderation &amp; Mandatory Audit Logging
                    </h2>
                    <p className="text-xs text-[#667781] dark:text-[#8696A0] leading-relaxed">
                      All statistics and conversations shown here are queried directly from Cloud Firestore through backend-verified owner endpoints ({DESIGNATED_OWNER_EMAIL}). Users are disclosed prior to chatting and at registration, and every owner access to conversation history or reported messages writes an immutable audit log entry before message content is returned.
                    </p>
                  </div>
                </div>

                {/* Recent Audit Logs */}
                <div className="bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                      Recent Audit &amp; Access Logs
                    </h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('logs')}
                      className="text-xs font-semibold text-[#008069] dark:text-[#00A884] hover:underline cursor-pointer"
                    >
                      View all logs
                    </button>
                  </div>
                  <div className="divide-y divide-[#E9EDEF] dark:divide-[#222E35]">
                    {dashboard.logs.slice(0, 6).map((entry) => (
                      <div key={entry.id} className="px-5 py-3 flex items-start justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <span className="font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                            {entry.actorName}
                          </span>{' '}
                          <span className="text-[#667781] dark:text-[#8696A0]">
                            ({entry.actorRole}) · {entry.action}
                          </span>
                          <div className="text-[#54656F] dark:text-[#AEBAC1] mt-0.5 break-words">
                            {entry.details}
                          </div>
                        </div>
                        <span className="font-mono tabular-nums text-[11px] text-[#667781] dark:text-[#8696A0] shrink-0">
                          {formatIsoDateTime(entry.createdAt)}
                        </span>
                      </div>
                    ))}
                    {dashboard.logs.length === 0 && (
                      <div className="px-5 py-8 text-center text-xs text-[#667781] dark:text-[#8696A0]">
                        No activity logged yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 2. ALL CONVERSATIONS TAB */}
            {activeTab === 'conversations' && dashboard && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                    <div className="md:col-span-4 relative">
                      <Search className="w-4 h-4 text-[#667781] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={convSearch}
                        onChange={(e) => setConvSearch(e.target.value)}
                        placeholder="Search by @username, name, or text"
                        className="w-full pl-10 pr-3.5 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs sm:text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
                      />
                    </div>

                    <div className="md:col-span-3">
                      <select
                        value={convUserUid}
                        onChange={(e) => setConvUserUid(e.target.value)}
                        aria-label="Filter by user"
                        className="w-full px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs sm:text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
                      >
                        <option value="all">All Users</option>
                        {dashboard.users.map((u) => (
                          <option key={u.uid} value={u.uid}>
                            {u.displayName} (@{u.username})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-[#667781] shrink-0" />
                      <input
                        type="date"
                        value={convDateFrom}
                        onChange={(e) => setConvDateFrom(e.target.value)}
                        aria-label="From date"
                        className="w-full px-2.5 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs text-[#111B21] dark:text-[#E9EDEF] outline-none"
                      />
                    </div>

                    <div className="md:col-span-2 flex items-center gap-1.5">
                      <span className="text-xs text-[#667781]">to</span>
                      <input
                        type="date"
                        value={convDateTo}
                        onChange={(e) => setConvDateTo(e.target.value)}
                        aria-label="To date"
                        className="w-full px-2.5 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs text-[#111B21] dark:text-[#E9EDEF] outline-none"
                      />
                    </div>

                    <div className="md:col-span-1 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setConvSearch('');
                          setConvUserUid('all');
                          setConvTypeFilter('all');
                          setConvDateFrom('');
                          setConvDateTo('');
                        }}
                        className="w-full py-2 px-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] hover:bg-[#E9EDEF] text-xs font-medium text-[#54656F] dark:text-[#AEBAC1] cursor-pointer"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['all', 'direct', 'group'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setConvTypeFilter(t)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize cursor-pointer ${
                            convTypeFilter === t
                              ? 'bg-[#008069] text-white'
                              : 'bg-[#F0F2F5] dark:bg-[#202C33] text-[#54656F] dark:text-[#AEBAC1]'
                          }`}
                        >
                          {t === 'all' ? 'All Chats' : t === 'direct' ? 'Direct Chats' : 'Group Chats'}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                      <Filter className="w-3.5 h-3.5 text-[#667781]" />
                      <button
                        type="button"
                        onClick={() => applyQuickDateFilter('today')}
                        className="px-2.5 py-1 rounded-lg bg-[#F0F2F5] dark:bg-[#202C33] text-[#54656F] dark:text-[#AEBAC1] hover:text-[#111B21] cursor-pointer"
                      >
                        Today
                      </button>
                      <button
                        type="button"
                        onClick={() => applyQuickDateFilter('7d')}
                        className="px-2.5 py-1 rounded-lg bg-[#F0F2F5] dark:bg-[#202C33] text-[#54656F] dark:text-[#AEBAC1] hover:text-[#111B21] cursor-pointer"
                      >
                        7 Days
                      </button>
                      <button
                        type="button"
                        onClick={() => applyQuickDateFilter('30d')}
                        className="px-2.5 py-1 rounded-lg bg-[#F0F2F5] dark:bg-[#202C33] text-[#54656F] dark:text-[#AEBAC1] hover:text-[#111B21] cursor-pointer"
                      >
                        30 Days
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl overflow-hidden divide-y divide-[#E9EDEF] dark:divide-[#222E35]">
                  {filteredConversations.map((c) => {
                    const displayTitle = getConversationDisplayTitle(c);
                    return (
                      <div
                        key={`${c.collection}:${c.id}`}
                        className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#F8FAFB] dark:hover:bg-[#162127]"
                      >
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] text-[10px] font-bold uppercase">
                              {c.type}
                            </span>
                            <span className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                              {displayTitle}
                            </span>
                            <span className="text-[11px] font-mono tabular-nums text-[#667781] dark:text-[#8696A0]">
                              {c.messageCount} {c.messageCount === 1 ? 'message' : 'messages'}
                            </span>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                                c.allParticipantsConsented
                                  ? 'bg-[#00A884]/12 text-[#008069] dark:text-[#00A884]'
                                  : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {c.allParticipantsConsented ? 'Policy Consented' : 'Consent Pending'}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-[#54656F] dark:text-[#AEBAC1]">
                            {c.participants.map((p, idx) => (
                              <span key={p.uid} className="inline-flex items-center gap-1">
                                <span className="font-medium text-[#111B21] dark:text-[#E9EDEF]">
                                  {p.displayName}
                                </span>
                                <span className="text-[#667781] dark:text-[#8696A0]">
                                  (@{p.username})
                                </span>
                                {idx < c.participants.length - 1 && (
                                  <span className="text-[#667781]">·</span>
                                )}
                              </span>
                            ))}
                          </div>

                          <div className="text-xs text-[#667781] dark:text-[#8696A0] truncate">
                            {c.lastMessageSenderName ? `${c.lastMessageSenderName}: ` : ''}
                            {c.lastMessageText || '(No text preview)'}
                          </div>
                        </div>

                        <div className="flex items-center justify-between lg:justify-end gap-3 shrink-0">
                          <div className="text-right">
                            <div className="text-[11px] font-mono tabular-nums text-[#667781] dark:text-[#8696A0]">
                              {formatIsoDateTime(c.lastMessageAt || c.createdAt)}
                            </div>
                            <div className="text-[10px] font-mono text-[#8696A0]">
                              {c.collection}/{c.id.slice(0, 14)}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setPendingConvTarget(c);
                              setConvAccessReason('');
                            }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Open History</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {filteredConversations.length === 0 && (
                    <div className="p-10 text-center text-xs text-[#667781] dark:text-[#8696A0]">
                      No conversations matched your search or date filter.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. USERS TAB */}
            {activeTab === 'users' && dashboard && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 text-[#667781] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search by name, @username, email, or UID"
                      className="w-full pl-10 pr-4 py-2 rounded-xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(['all', 'online', 'offline', 'restricted', 'consented'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setUserFilter(f)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize cursor-pointer ${
                          userFilter === f
                            ? 'bg-[#008069] text-white'
                            : 'bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] text-[#54656F] dark:text-[#AEBAC1]'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#E9EDEF] dark:border-[#222E35] text-[11px] font-semibold uppercase tracking-wider text-[#667781] dark:text-[#8696A0]">
                          <th className="py-3 px-4">User</th>
                          <th className="py-3 px-4">Email</th>
                          <th className="py-3 px-4">Presence</th>
                          <th className="py-3 px-4">Registered</th>
                          <th className="py-3 px-4">Privacy Consent</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E9EDEF] dark:divide-[#222E35] text-xs">
                        {filteredUsers.map((u) => {
                          const isOwnerRow = u.uid === dashboard.owner.uid;
                          return (
                            <tr key={u.uid} className="hover:bg-[#F8FAFB] dark:hover:bg-[#162127]">
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2.5 min-w-[170px]">
                                  <Avatar
                                    src={u.photoURL}
                                    name={u.displayName}
                                    size="sm"
                                    isOnline={u.isOnline}
                                  />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                                      {u.displayName}
                                      {isOwnerRow && (
                                        <span className="ml-1.5 text-[10px] font-bold text-[#008069] dark:text-[#00A884]">
                                          [OWNER]
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-[#667781] dark:text-[#8696A0]">
                                      @{u.username}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-[#54656F] dark:text-[#AEBAC1]">
                                {u.email || '—'}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`font-medium ${
                                    u.isOnline
                                      ? 'text-[#008069] dark:text-[#00A884]'
                                      : 'text-[#667781] dark:text-[#8696A0]'
                                  }`}
                                >
                                  {u.isOnline ? 'Online' : 'Offline'}
                                </span>
                              </td>
                              <td className="py-3 px-4 font-mono tabular-nums text-[#667781] dark:text-[#8696A0] whitespace-nowrap">
                                {formatIsoDateShort(u.createdAt)}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <span
                                  className={`font-semibold ${
                                    u.consented
                                      ? 'text-[#008069] dark:text-[#00A884]'
                                      : 'text-amber-600 dark:text-amber-400'
                                  }`}
                                >
                                  {u.consented ? 'Consented' : 'Pending'}
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <span
                                  className={`font-semibold capitalize ${
                                    u.moderationStatus === 'active'
                                      ? 'text-[#008069] dark:text-[#00A884]'
                                      : u.moderationStatus === 'suspended'
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-red-600 dark:text-red-400'
                                  }`}
                                >
                                  {u.moderationStatus}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setInspectingUser(u)}
                                    className="px-2.5 py-1 rounded-lg bg-[#F0F2F5] dark:bg-[#202C33] hover:bg-[#E9EDEF] text-[#111B21] dark:text-[#E9EDEF] font-medium cursor-pointer"
                                  >
                                    Profile
                                  </button>

                                  {!isOwnerRow && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setModeratingUser(u);
                                        setModStatus(
                                          u.moderationStatus === 'active' ? 'suspended' : 'active'
                                        );
                                        setModReason(u.moderationReason || '');
                                      }}
                                      className="px-2.5 py-1 rounded-lg border border-[#E9EDEF] dark:border-[#222E35] hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 text-[#54656F] dark:text-[#AEBAC1] font-medium cursor-pointer inline-flex items-center gap-1"
                                    >
                                      {u.moderationStatus === 'active' ? (
                                        <>
                                          <Ban className="w-3.5 h-3.5" />
                                          <span>Moderate</span>
                                        </>
                                      ) : (
                                        <>
                                          <UserCheck className="w-3.5 h-3.5" />
                                          <span>Restore</span>
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {filteredUsers.length === 0 && (
                    <div className="p-8 text-center text-xs text-[#667781] dark:text-[#8696A0]">
                      No users matched your filter.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 4. MODERATION REPORTS TAB */}
            {activeTab === 'reports' && dashboard && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(['all', 'open', 'under_review', 'resolved', 'dismissed'] as const).map(
                      (status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => setReportFilter(status)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize cursor-pointer ${
                            reportFilter === status
                              ? 'bg-[#008069] text-white'
                              : 'bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] text-[#54656F] dark:text-[#AEBAC1]'
                          }`}
                        >
                          {status.replace('_', ' ')}
                        </button>
                      )
                    )}
                  </div>
                  <div className="text-xs text-[#667781] dark:text-[#8696A0]">
                    Every report inspection is recorded with a user notice &amp; audit entry
                  </div>
                </div>

                <div className="space-y-3">
                  {filteredReports.map((rep) => (
                    <div
                      key={rep.id}
                      className="p-4 rounded-2xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-amber-500/12 text-amber-700 dark:text-amber-300 text-[10px] font-bold uppercase">
                            {rep.reportType}
                          </span>
                          <span className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                            Reported: {rep.reportedName}
                          </span>
                          <span className="text-xs text-[#667781] dark:text-[#8696A0]">
                            by {rep.reportedByName} · {formatIsoDateTime(rep.createdAt)}
                          </span>
                        </div>
                        <div className="text-xs text-[#54656F] dark:text-[#AEBAC1]">
                          Reason: <strong className="font-semibold">{rep.reason}</strong>
                          {rep.details ? ` — ${rep.details}` : ''}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#667781] dark:text-[#8696A0]">
                          <span className="capitalize font-semibold">
                            Status: {rep.status.replace('_', ' ')}
                          </span>
                          {rep.userNoticeSent && <span>Moderation notice recorded</span>}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setReviewingReport(rep);
                          setReportAccessReason('');
                          setReportResolutionNote(rep.resolutionNote || '');
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold cursor-pointer shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>
                          {rep.status === 'open' ? 'Open with Notice' : 'Inspect Report'}
                        </span>
                      </button>
                    </div>
                  ))}

                  {filteredReports.length === 0 && (
                    <div className="p-10 rounded-2xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] text-center text-xs text-[#667781] dark:text-[#8696A0]">
                      No moderation reports in this filter.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 5. AUDIT LOGS TAB */}
            {activeTab === 'logs' && dashboard && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative max-w-md flex-1">
                    <Search className="w-4 h-4 text-[#667781] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      placeholder="Filter audit logs by action, actor, or target"
                      className="w-full pl-10 pr-4 py-2 rounded-xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(
                      [
                        { id: 'all', label: 'All Logs' },
                        { id: 'access', label: 'Conversation & Message Access' },
                        { id: 'moderation', label: 'Moderation' },
                        { id: 'settings', label: 'Privacy & Settings' },
                      ] as const
                    ).map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setLogCategory(cat.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                          logCategory === cat.id
                            ? 'bg-[#008069] text-white'
                            : 'bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] text-[#54656F] dark:text-[#AEBAC1]'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl divide-y divide-[#E9EDEF] dark:divide-[#222E35]">
                  {filteredLogs.map((l) => {
                    const isAccessLog =
                      l.action === 'owner_conversation_accessed' ||
                      l.action === 'report_message_accessed';
                    return (
                      <div key={l.id} className="p-4 flex items-start justify-between gap-3 text-xs">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                                isAccessLog
                                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                  : 'bg-[#00A884]/12 text-[#008069] dark:text-[#00A884]'
                              }`}
                            >
                              {l.action}
                            </span>
                            <span className="font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                              {l.actorName}
                            </span>
                            {l.targetLabel && (
                              <span className="text-[#667781] dark:text-[#8696A0]">
                                → {l.targetLabel}
                              </span>
                            )}
                          </div>
                          <div className="text-[#54656F] dark:text-[#AEBAC1] break-words">
                            {l.details}
                          </div>
                        </div>
                        <span className="font-mono tabular-nums text-[11px] text-[#667781] dark:text-[#8696A0] shrink-0">
                          {formatIsoDateTime(l.createdAt)}
                        </span>
                      </div>
                    );
                  })}
                  {filteredLogs.length === 0 && (
                    <div className="p-8 text-center text-xs text-[#667781] dark:text-[#8696A0]">
                      No audit logs matched your filter.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 6. PRIVACY & WEBSITE SETTINGS TAB */}
            {activeTab === 'settings' && (
              <form
                onSubmit={handleSaveSettings}
                className="bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl p-5 sm:p-6 space-y-5"
              >
                <div>
                  <h2 className="text-base font-bold text-[#111B21] dark:text-[#E9EDEF]">
                    Website, Privacy Disclosure &amp; Retention Settings
                  </h2>
                  <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-0.5">
                    Configure platform features, pre-chat owner moderation disclosure, and data retention policy.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                      Website Name
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={60}
                      value={settingsDraft.siteName}
                      onChange={(e) =>
                        setSettingsDraft((s) => ({ ...s, siteName: e.target.value }))
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                      Data Retention Period (Days)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      required
                      value={settingsDraft.dataRetentionDays}
                      onChange={(e) =>
                        setSettingsDraft((s) => ({
                          ...s,
                          dataRetentionDays: Number(e.target.value) || 365,
                        }))
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                    Global Welcome Notice Banner (optional)
                  </label>
                  <input
                    type="text"
                    maxLength={300}
                    value={settingsDraft.welcomeNotice}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({ ...s, welcomeNotice: e.target.value }))
                    }
                    placeholder="e.g. Scheduled maintenance tonight at 11:00 PM UTC"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                    User-Visible Privacy &amp; Owner Moderation Disclosure
                  </label>
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={settingsDraft.moderationPolicySummary}
                    onChange={(e) =>
                      setSettingsDraft((s) => ({
                        ...s,
                        moderationPolicySummary: e.target.value,
                      }))
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none resize-none"
                  />
                  <p className="text-[11px] text-[#667781] dark:text-[#8696A0] mt-1">
                    Shown before users start chatting and inside Privacy &amp; Moderation Policy.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] text-xs text-[#667781] dark:text-[#8696A0] flex items-start gap-2.5">
                  <Clock className="w-4 h-4 text-[#008069] dark:text-[#00A884] shrink-0 mt-0.5" />
                  <span>{DATA_RETENTION_POLICY_TEXT}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {(
                    [
                      {
                        key: 'ownerMonitoringEnabled',
                        label: 'Owner Chat Monitoring Enabled',
                        desc: 'Allow verified owner dashboard conversation review (audit-logged)',
                      },
                      {
                        key: 'allowPrivateContextReview',
                        label: 'Allow Private Conversation History Review',
                        desc: 'Permit opening full thread history with documented reason',
                      },
                      {
                        key: 'allowNewRegistrations',
                        label: 'Allow New Account Registrations',
                        desc: 'Allow new users to sign up on VerdeChat',
                      },
                      {
                        key: 'allowGroupCreation',
                        label: 'Allow Group Chat Creation',
                        desc: 'Let users create new groupChat threads',
                      },
                      {
                        key: 'allowVoiceVideoCalls',
                        label: 'Allow Voice & Video Calls',
                        desc: 'Enable WebRTC audio and video calling',
                      },
                      {
                        key: 'allowMediaUploads',
                        label: 'Allow Media & Voice Uploads',
                        desc: 'Permit photos, videos, and voice notes in chats',
                      },
                      {
                        key: 'maintenanceMode',
                        label: 'Maintenance Mode',
                        desc: 'Temporarily pause regular user chat access',
                      },
                    ] as const
                  ).map((toggle) => (
                    <label
                      key={toggle.key}
                      className="p-3.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] flex items-start justify-between gap-3 cursor-pointer"
                    >
                      <div>
                        <div className="text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                          {toggle.label}
                        </div>
                        <div className="text-[11px] text-[#667781] dark:text-[#8696A0] mt-0.5">
                          {toggle.desc}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settingsDraft[toggle.key]}
                        onChange={(e) =>
                          setSettingsDraft((s) => ({ ...s, [toggle.key]: e.target.checked }))
                        }
                        className="mt-0.5 rounded accent-[#008069] w-4 h-4 shrink-0"
                      />
                    </label>
                  ))}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-50 text-white text-xs sm:text-sm font-semibold cursor-pointer inline-flex items-center gap-2"
                  >
                    {savingSettings && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>Save &amp; Log Settings</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* AUDIT REASON GATE MODAL BEFORE OPENING PRIVATE CONVERSATION */}
      {pendingConvTarget && (
        <div
          className="fixed inset-0 z-60 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Audit confirmation before opening conversation"
        >
          <form
            onSubmit={handleOpenConversationWithAudit}
            className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-xl p-5 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/12 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#111B21] dark:text-[#E9EDEF]">
                    Audit-Logged Conversation Access
                  </h3>
                  <p className="text-xs text-[#667781] dark:text-[#8696A0]">
                    {getConversationDisplayTitle(pendingConvTarget)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingConvTarget(null)}
                className="text-[#667781] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] text-xs text-[#54656F] dark:text-[#AEBAC1] leading-relaxed">
              Opening this conversation records a permanent{' '}
              <span className="font-mono text-[#111B21] dark:text-[#E9EDEF]">
                owner_conversation_accessed
              </span>{' '}
              audit log entry under your owner account ({DESIGNATED_OWNER_EMAIL}) before loading messages.
            </div>

            <div>
              <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                Documented Moderation / Safety Reason
              </label>
              <textarea
                rows={3}
                required
                minLength={3}
                maxLength={400}
                value={convAccessReason}
                onChange={(e) => setConvAccessReason(e.target.value)}
                placeholder="e.g. Reviewing conversation for safety compliance / spam report follow-up"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingConvTarget(null)}
                className="px-4 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={convLoading || convAccessReason.trim().length < 3}
                className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
              >
                {convLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Log Access &amp; View History</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* OPENED CONVERSATION HISTORY MODAL */}
      {openedConversation && (
        <div
          className="fixed inset-0 z-60 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Conversation history review"
        >
          <div className="w-full max-w-3xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-xl flex flex-col max-h-[90dvh] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] text-[10px] font-bold uppercase">
                    {openedConversation.conversation.type}
                  </span>
                  <h3 className="text-sm sm:text-base font-bold text-[#111B21] dark:text-[#E9EDEF] truncate">
                    {getConversationDisplayTitle(openedConversation.conversation)}
                  </h3>
                </div>
                <p className="text-[11px] text-[#667781] dark:text-[#8696A0] truncate mt-0.5">
                  Audit Log: <span className="font-mono">{openedConversation.auditLogId}</span> ·{' '}
                  {openedConversation.messages.length} total messages · Reason:{' '}
                  {openedConversation.reason}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenedConversation(null)}
                aria-label="Close conversation viewer"
                className="min-w-[36px] min-h-[36px] rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] flex items-center justify-center text-[#54656F] dark:text-[#8696A0] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-2.5 bg-[#F8FAFB] dark:bg-[#162127] border-b border-[#E9EDEF] dark:border-[#222E35] flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {openedConversation.conversation.participants.map((p) => (
                  <span
                    key={p.uid}
                    className="px-2 py-0.5 rounded-lg bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] text-[#111B21] dark:text-[#E9EDEF]"
                  >
                    {p.displayName} (@{p.username})
                  </span>
                ))}
              </div>
              <div className="relative sm:w-56">
                <Search className="w-3.5 h-3.5 text-[#667781] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={threadMessageFilter}
                  onChange={(e) => setThreadMessageFilter(e.target.value)}
                  placeholder="Search inside chat..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] text-xs text-[#111B21] dark:text-[#E9EDEF] outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-[#EFEAE2] dark:bg-[#0B141A]">
              {filteredThreadMessages.map((msg) => {
                const receiverText =
                  msg.receivers.length > 0
                    ? msg.receivers.map((r) => `${r.displayName} (@${r.username})`).join(', ')
                    : 'Participants';
                return (
                  <div
                    key={msg.id}
                    className="p-3.5 rounded-2xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] space-y-1.5 shadow-2xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="font-semibold text-[#008069] dark:text-[#00A884]">
                        {msg.senderName} (@{msg.senderUsername}){' '}
                        <span className="font-normal text-[#667781] dark:text-[#8696A0]">
                          → {receiverText}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-[#667781] dark:text-[#8696A0]">
                        {formatIsoDateTime(msg.createdAt)}
                      </span>
                    </div>

                    {msg.text && (
                      <p className="text-xs sm:text-sm text-[#111B21] dark:text-[#E9EDEF] whitespace-pre-wrap break-words">
                        {msg.text}
                      </p>
                    )}

                    {msg.mediaUrl && (
                      <div className="pt-1">
                        {msg.type === 'image' ? (
                          <img
                            src={msg.mediaUrl}
                            alt={msg.mediaName || 'Shared image'}
                            className="max-h-56 rounded-xl object-contain border border-[#E9EDEF] dark:border-[#222E35]"
                          />
                        ) : msg.type === 'video' ? (
                          <video
                            src={msg.mediaUrl}
                            controls
                            className="max-h-56 rounded-xl border border-[#E9EDEF] dark:border-[#222E35]"
                          />
                        ) : msg.type === 'audio' ? (
                          <audio src={msg.mediaUrl} controls className="w-full max-w-xs" />
                        ) : (
                          <a
                            href={msg.mediaUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[#008069] dark:text-[#00A884] underline"
                          >
                            {msg.mediaName || 'Open attachment'}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredThreadMessages.length === 0 && (
                <div className="py-12 text-center text-xs text-[#667781] dark:text-[#8696A0]">
                  No messages found in this conversation.
                </div>
              )}
            </div>

            <div className="px-5 py-3 bg-[#F8FAFB] dark:bg-[#162127] border-t border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between gap-3 shrink-0">
              <span className="text-[11px] text-[#667781] dark:text-[#8696A0]">
                Accessed at {formatIsoDateTime(openedConversation.accessedAt)}
              </span>
              <button
                type="button"
                onClick={() => setOpenedConversation(null)}
                className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold cursor-pointer"
              >
                Close Viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* USER PROFILE DETAILS MODAL */}
      {inspectingUser && (
        <div
          className="fixed inset-0 z-60 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="User profile details"
        >
          <div className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar
                  src={inspectingUser.photoURL}
                  name={inspectingUser.displayName}
                  size="lg"
                  isOnline={inspectingUser.isOnline}
                />
                <div>
                  <h3 className="text-base font-bold text-[#111B21] dark:text-[#E9EDEF]">
                    {inspectingUser.displayName}
                  </h3>
                  <div className="text-xs text-[#667781] dark:text-[#8696A0]">
                    @{inspectingUser.username}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectingUser(null)}
                className="text-[#667781] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] flex justify-between gap-2">
                <span className="text-[#667781]">Email</span>
                <span className="font-medium text-[#111B21] dark:text-[#E9EDEF]">
                  {inspectingUser.email || '—'}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] flex justify-between gap-2">
                <span className="text-[#667781]">UID</span>
                <span className="font-mono text-[#111B21] dark:text-[#E9EDEF]">
                  {inspectingUser.uid}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] flex justify-between gap-2">
                <span className="text-[#667781]">Registered</span>
                <span className="font-mono text-[#111B21] dark:text-[#E9EDEF]">
                  {formatIsoDateTime(inspectingUser.createdAt)}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] flex justify-between gap-2">
                <span className="text-[#667781]">Last Seen</span>
                <span className="font-mono text-[#111B21] dark:text-[#E9EDEF]">
                  {inspectingUser.isOnline ? 'Online now' : formatIsoDateTime(inspectingUser.lastSeen)}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] flex justify-between gap-2">
                <span className="text-[#667781]">Privacy Consent</span>
                <span className="font-medium text-[#111B21] dark:text-[#E9EDEF]">
                  {inspectingUser.consented
                    ? `Accepted (${formatIsoDateShort(inspectingUser.consentedAt)})`
                    : 'Not yet accepted'}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#F8FAFB] dark:bg-[#162127]">
                <div className="text-[#667781] mb-1">About</div>
                <div className="text-[#111B21] dark:text-[#E9EDEF]">
                  {inspectingUser.about || '—'}
                </div>
              </div>
            </div>

            <div className="flex justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setConvUserUid(inspectingUser.uid);
                  setInspectingUser(null);
                  setActiveTab('conversations');
                }}
                className="px-3.5 py-2 rounded-xl bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] text-xs font-semibold cursor-pointer"
              >
                View User Conversations
              </button>
              <button
                type="button"
                onClick={() => setInspectingUser(null)}
                className="px-4 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODERATE USER ACCOUNT MODAL */}
      {moderatingUser && (
        <div
          className="fixed inset-0 z-60 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Moderate user account"
        >
          <form
            onSubmit={handleModerateSubmit}
            className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#111B21] dark:text-[#E9EDEF]">
                Account Action · {moderatingUser.displayName}
              </h3>
              <button
                type="button"
                onClick={() => setModeratingUser(null)}
                className="text-[#667781] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                Account Status
              </label>
              <select
                value={modStatus}
                onChange={(e) => setModStatus(e.target.value as AccountModerationStatus)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
              >
                <option value="active">Active (Restore access)</option>
                <option value="suspended">Suspended (Temporary lockout)</option>
                <option value="blocked">Banned / Blocked (Permanent restriction)</option>
                <option value="removed">Removed from Public Directory</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                Audit Reason
              </label>
              <textarea
                rows={3}
                required
                maxLength={500}
                value={modReason}
                onChange={(e) => setModReason(e.target.value)}
                placeholder="Explain why this account status is being updated..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModeratingUser(null)}
                className="px-4 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={modSubmitting}
                className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
              >
                {modSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Apply &amp; Audit Log</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* REPORT MODERATION MODAL */}
      {reviewingReport && (
        <div
          className="fixed inset-0 z-60 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Inspect moderation report"
        >
          <div className="w-full max-w-lg bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-xl p-5 space-y-4 max-h-[88dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#111B21] dark:text-[#E9EDEF]">
                  Moderation Report Review
                </h3>
                <p className="text-xs text-[#667781] dark:text-[#8696A0]">
                  Reported: {reviewingReport.reportedName} · Reporter:{' '}
                  {reviewingReport.reportedByName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewingReport(null)}
                className="text-[#667781] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!reviewingReport.userNoticeSent ? (
              <div className="space-y-3">
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                  <strong>Privacy Notice Gate:</strong> Reported message content stays sealed until
                  you record a moderation reason, send an audit privacy notice, and log the access.
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                    Documented Moderation Reason
                  </label>
                  <textarea
                    rows={3}
                    value={reportAccessReason}
                    onChange={(e) => setReportAccessReason(e.target.value)}
                    placeholder="e.g. Reviewing reported harassment message for policy enforcement."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none resize-none"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setReviewingReport(null)}
                    className="px-4 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs font-semibold cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    disabled={reportSubmitting || reportAccessReason.trim().length < 3}
                    onClick={() => void handleUnlockReport(reviewingReport)}
                    className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                  >
                    Record Notice &amp; Unlock Content
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-[#00A884]/10 border border-[#00A884]/20 text-xs text-[#008069] dark:text-[#00A884]">
                  Moderation notice &amp; audit entry recorded.
                </div>

                {reviewingReport.messageTextSnippet && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                      Reported Message
                    </div>
                    <div className="p-3 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] text-xs text-[#111B21] dark:text-[#E9EDEF]">
                      {reviewingReport.messageTextSnippet}
                    </div>
                  </div>
                )}

                {reviewingReport.contextMessages.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                      Consented Surrounding Context
                    </div>
                    <div className="p-3 rounded-xl bg-[#F8FAFB] dark:bg-[#162127] border border-[#E9EDEF] dark:border-[#222E35] space-y-1.5 text-xs text-[#54656F] dark:text-[#AEBAC1]">
                      {reviewingReport.contextMessages.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                    Resolution Note
                  </label>
                  <textarea
                    rows={2}
                    value={reportResolutionNote}
                    onChange={(e) => setReportResolutionNote(e.target.value)}
                    placeholder="Summary of moderation decision..."
                    className="w-full px-3.5 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none resize-none"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={reportSubmitting}
                    onClick={() => void handleResolveReport(reviewingReport, 'dismissed')}
                    className="px-3.5 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] cursor-pointer"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    disabled={reportSubmitting}
                    onClick={() => void handleResolveReport(reviewingReport, 'resolved')}
                    className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold cursor-pointer"
                  >
                    Mark Resolved
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
