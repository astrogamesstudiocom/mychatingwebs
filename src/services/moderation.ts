import type { User } from 'firebase/auth';
import {
  deleteDoc,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  BLUEPRINT_LIMITS,
  DESIGNATED_OWNER_EMAIL,
  PRIVACY_POLICY_VERSION,
  type AccountModerationStatus,
  type AdminPermissions,
  type AdminRoleType,
  type ChatCollection,
  type OwnerConversationSummary,
  type OwnerDashboardPayload,
  type OwnerMessageRecord,
  type OwnerReportRow,
  type ReportStatus,
  type ReportType,
  type WebsiteSettings,
} from '../types';
import { generateId } from '../utils/chatHelpers';

export const DEFAULT_MODERATION_POLICY =
  'For platform safety, abuse prevention, and community guideline enforcement, the verified Website Owner account (fezinfezin42@gmail.com) may review conversation history and reported messages when necessary for moderation. Ordinary users can never access other users’ private chats. Every administrative access to conversation history or reported messages is permanently recorded in an immutable security audit log.';

export const DATA_RETENTION_POLICY_TEXT =
  'Chat messages, shared media metadata, privacy consent records, and moderation reports are retained while your account remains active and for up to the configured retention period (default 365 days) for safety, dispute resolution, and audit compliance. Security audit logs recording administrative access remain immutable.';

export const DEFAULT_WEBSITE_SETTINGS: Omit<WebsiteSettings, 'updatedBy' | 'updatedAt'> = {
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
};

export interface AuditActor {
  uid: string;
  name: string;
  role: 'owner' | 'admin' | 'user';
}

export async function logSystemActivity(input: {
  action: string;
  actor: AuditActor;
  targetId?: string;
  targetLabel?: string;
  details: string;
}): Promise<void> {
  const logId = generateId('log');
  try {
    await setDoc(doc(db, 'systemLogs', logId), {
      action: input.action.slice(0, 80),
      actorUid: input.actor.uid,
      actorName: (input.actor.name || 'User').slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
      actorRole: input.actor.role,
      targetId: (input.targetId || '').slice(0, 128),
      targetLabel: (input.targetLabel || '').slice(0, 120),
      details: input.details.slice(0, BLUEPRINT_LIMITS.LOG_DETAILS_MAX),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Audit log write failed:', err);
  }
}

export async function incrementSystemStat(
  field: 'totalMessages' | 'totalChats' | 'totalGroupChats' | 'totalCalls'
): Promise<void> {
  const statsRef = doc(db, 'systemStats', 'overview');
  try {
    const snap = await getDoc(statsRef);
    if (!snap.exists()) {
      await setDoc(statsRef, {
        totalMessages: field === 'totalMessages' ? 1 : 0,
        totalChats: field === 'totalChats' ? 1 : 0,
        totalGroupChats: field === 'totalGroupChats' ? 1 : 0,
        totalCalls: field === 'totalCalls' ? 1 : 0,
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(statsRef, {
        [field]: increment(1),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Non-blocking metrics update
  }
}

export async function submitPrivacyConsent(uid: string, displayName: string): Promise<void> {
  const consentRef = doc(db, 'userPrivacyConsents', uid);
  try {
    const existing = await getDoc(consentRef);
    if (existing.exists()) {
      await updateDoc(consentRef, {
        consented: true,
        policyVersion: PRIVACY_POLICY_VERSION,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(consentRef, {
        uid,
        consented: true,
        policyVersion: PRIVACY_POLICY_VERSION,
        consentedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await logSystemActivity({
      action: 'privacy_consent_accepted',
      actor: { uid, name: displayName || 'User', role: 'user' },
      targetId: uid,
      targetLabel: PRIVACY_POLICY_VERSION,
      details: `User acknowledged privacy disclosure, owner moderation policy, and data retention policy (${PRIVACY_POLICY_VERSION}).`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `userPrivacyConsents/${uid}`);
  }
}

async function ownerApiFetch<T>(
  user: User,
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await user.getIdToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Non-JSON response
  }

  if (!res.ok) {
    const msg =
      (payload as { error?: string } | null)?.error ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return payload as T;
}

export async function verifyOwnerWithServer(user: User): Promise<{
  authorized: boolean;
  isSuperAdmin: boolean;
  ownerConfigured: boolean;
  ownerEmail?: string;
}> {
  try {
    return await ownerApiFetch(user, '/api/owner/verify', { method: 'POST' });
  } catch {
    return { authorized: false, isSuperAdmin: false, ownerConfigured: true };
  }
}

export async function verifyAdminWithServer(user: User): Promise<{
  authorized: boolean;
  isSuperAdmin: boolean;
  ownerConfigured: boolean;
}> {
  return verifyOwnerWithServer(user);
}

export async function fetchOwnerDashboard(user: User): Promise<OwnerDashboardPayload> {
  return ownerApiFetch<OwnerDashboardPayload>(user, '/api/owner/dashboard', {
    method: 'GET',
  });
}

export async function accessOwnerConversation(
  user: User,
  input: {
    collection: ChatCollection;
    chatId: string;
    reason: string;
  }
): Promise<{
  conversation: OwnerConversationSummary;
  messages: OwnerMessageRecord[];
  auditLogId: string;
  accessedAt: string;
}> {
  return ownerApiFetch(
    user,
    `/api/owner/conversations/${encodeURIComponent(input.collection)}/${encodeURIComponent(
      input.chatId
    )}/access`,
    {
      method: 'POST',
      body: JSON.stringify({ reason: input.reason }),
    }
  );
}

export async function moderateUserViaServer(
  user: User,
  input: {
    targetUid: string;
    status: AccountModerationStatus;
    reason: string;
  }
): Promise<{ ok: boolean; status: AccountModerationStatus }> {
  return ownerApiFetch(
    user,
    `/api/owner/users/${encodeURIComponent(input.targetUid)}/moderate`,
    {
      method: 'POST',
      body: JSON.stringify({
        status: input.status,
        reason: input.reason,
      }),
    }
  );
}

export async function accessReportViaServer(
  user: User,
  input: { reportId: string; reason: string }
): Promise<{ report: OwnerReportRow; auditLogId: string }> {
  return ownerApiFetch(
    user,
    `/api/owner/reports/${encodeURIComponent(input.reportId)}/access`,
    {
      method: 'POST',
      body: JSON.stringify({ reason: input.reason }),
    }
  );
}

export async function resolveReportViaServer(
  user: User,
  input: {
    reportId: string;
    status: Extract<ReportStatus, 'resolved' | 'dismissed'>;
    resolutionNote: string;
  }
): Promise<{ ok: boolean; status: ReportStatus }> {
  return ownerApiFetch(
    user,
    `/api/owner/reports/${encodeURIComponent(input.reportId)}/resolve`,
    {
      method: 'POST',
      body: JSON.stringify({
        status: input.status,
        resolutionNote: input.resolutionNote,
      }),
    }
  );
}

export async function saveWebsiteSettingsViaServer(
  user: User,
  settings: {
    siteName: string;
    welcomeNotice: string;
    moderationPolicySummary: string;
    allowNewRegistrations: boolean;
    allowGroupCreation: boolean;
    allowVoiceVideoCalls: boolean;
    allowMediaUploads: boolean;
    maintenanceMode: boolean;
    ownerMonitoringEnabled: boolean;
    allowPrivateContextReview: boolean;
    dataRetentionDays: number;
  }
): Promise<{ ok: boolean }> {
  return ownerApiFetch(user, '/api/owner/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function claimSuperAdminOwnership(user: User, displayName: string): Promise<void> {
  if (!user.emailVerified || (user.email || '').toLowerCase() !== DESIGNATED_OWNER_EMAIL) {
    throw new Error('Only the verified designated Website Owner can initialize Super Admin.');
  }

  const ownerRef = doc(db, 'systemConfig', 'owner');
  const existingOwner = await getDoc(ownerRef);
  if (existingOwner.exists()) {
    throw new Error('Super Admin ownership is already locked to the owner account.');
  }

  const settingsRef = doc(db, 'websiteSettings', 'global');
  const statsRef = doc(db, 'systemStats', 'overview');
  const [settingsSnap, statsSnap] = await Promise.all([getDoc(settingsRef), getDoc(statsRef)]);

  const cleanName = (displayName || user.displayName || 'Website Owner')
    .trim()
    .slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX);
  const logId = generateId('log');
  const batch = writeBatch(db);

  batch.set(ownerRef, {
    ownerUid: user.uid,
    ownerEmail: DESIGNATED_OWNER_EMAIL,
    locked: true,
    configuredAt: serverTimestamp(),
  });

  batch.set(doc(db, 'admins', user.uid), {
    uid: user.uid,
    email: DESIGNATED_OWNER_EMAIL,
    displayName: cleanName,
    role: 'super_admin',
    permissions: {
      viewUsers: true,
      manageReports: true,
      suspendUsers: true,
      manageSettings: true,
      viewLogs: true,
    },
    grantedBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (!settingsSnap.exists()) {
    batch.set(settingsRef, {
      ...DEFAULT_WEBSITE_SETTINGS,
      updatedBy: user.uid,
      updatedAt: serverTimestamp(),
    });
  }

  if (!statsSnap.exists()) {
    batch.set(statsRef, {
      totalMessages: 0,
      totalChats: 0,
      totalGroupChats: 0,
      totalCalls: 0,
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(doc(db, 'systemLogs', logId), {
    action: 'super_admin_initialized',
    actorUid: user.uid,
    actorName: cleanName,
    actorRole: 'owner',
    targetId: user.uid,
    targetLabel: DESIGNATED_OWNER_EMAIL,
    details: 'One-time Super Admin ownership locked to verified owner UID.',
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    await verifyOwnerWithServer(user);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'systemConfig/owner');
  }
}

export async function submitModerationReport(input: {
  reportType: ReportType;
  reportedUid: string;
  reportedName: string;
  reporterUid: string;
  reporterName: string;
  chatId?: string;
  chatCollection?: '' | ChatCollection;
  messageId?: string;
  messageTextSnippet?: string;
  contextMessages?: string[];
  reason: string;
  details: string;
}): Promise<string> {
  const reportId = generateId('rep');
  const cleanReason = input.reason.trim().slice(0, BLUEPRINT_LIMITS.REASON_MAX);
  if (!cleanReason) {
    throw new Error('Please choose a reason for reporting.');
  }

  const contextMessages = (input.contextMessages || [])
    .map((m) => m.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 5);

  try {
    await setDoc(doc(db, 'reports', reportId), {
      reportType: input.reportType,
      reportedUid: input.reportedUid,
      reportedName: (input.reportedName || 'User').slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
      reportedByUid: input.reporterUid,
      reportedByName: (input.reporterName || 'User').slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
      chatId: (input.chatId || '').slice(0, 128),
      chatCollection: input.chatCollection || '',
      messageId: (input.messageId || '').slice(0, 128),
      messageTextSnippet: (input.messageTextSnippet || '').slice(0, 1000),
      contextMessages,
      reason: cleanReason,
      details: input.details.trim().slice(0, BLUEPRINT_LIMITS.DETAILS_MAX),
      status: 'open',
      resolutionNote: '',
      reviewedBy: '',
      userNoticeSent: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await logSystemActivity({
      action: 'report_submitted',
      actor: {
        uid: input.reporterUid,
        name: input.reporterName,
        role: 'user',
      },
      targetId: input.reportedUid,
      targetLabel: input.reportedName,
      details: `User submitted ${input.reportType} report (${cleanReason}).`,
    });

    return reportId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `reports/${reportId}`);
  }
}

export async function reviewReportWithNotice(input: {
  reportId: string;
  reportedUid: string;
  reportedName: string;
  reviewReason: string;
  actor: AuditActor;
}): Promise<void> {
  const cleanNote = input.reviewReason.trim().slice(0, BLUEPRINT_LIMITS.RESOLUTION_NOTE_MAX);
  if (!cleanNote) {
    throw new Error('A documented moderation reason is required before opening reported content.');
  }

  try {
    await updateDoc(doc(db, 'reports', input.reportId), {
      status: 'under_review',
      resolutionNote: cleanNote,
      reviewedBy: input.actor.uid,
      userNoticeSent: true,
      updatedAt: serverTimestamp(),
    });

    await logSystemActivity({
      action: 'report_context_reviewed',
      actor: input.actor,
      targetId: input.reportId,
      targetLabel: input.reportedName || input.reportedUid,
      details: `Moderation notice logged & reported context accessed: ${cleanNote}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `reports/${input.reportId}`);
  }
}

export async function updateReportResolution(input: {
  reportId: string;
  reportedName: string;
  status: Extract<ReportStatus, 'resolved' | 'dismissed'>;
  resolutionNote: string;
  actor: AuditActor;
}): Promise<void> {
  const cleanNote = input.resolutionNote.trim().slice(0, BLUEPRINT_LIMITS.RESOLUTION_NOTE_MAX);
  try {
    await updateDoc(doc(db, 'reports', input.reportId), {
      status: input.status,
      resolutionNote: cleanNote,
      reviewedBy: input.actor.uid,
      userNoticeSent: true,
      updatedAt: serverTimestamp(),
    });

    await logSystemActivity({
      action: `report_${input.status}`,
      actor: input.actor,
      targetId: input.reportId,
      targetLabel: input.reportedName,
      details: cleanNote || `Marked report as ${input.status}.`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `reports/${input.reportId}`);
  }
}

export async function moderateUserAccount(input: {
  targetUid: string;
  targetName: string;
  targetUsername?: string;
  status: AccountModerationStatus;
  reason: string;
  actor: AuditActor;
  ownerUid?: string | null;
}): Promise<void> {
  if (input.ownerUid && input.targetUid === input.ownerUid) {
    throw new Error('The Website Owner / Super Admin account cannot be restricted or removed.');
  }

  const cleanReason = input.reason.trim().slice(0, 500);
  const modRef = doc(db, 'accountModeration', input.targetUid);
  const pubRef = doc(db, 'publicProfiles', input.targetUid);

  try {
    const existingMod = await getDoc(modRef);
    const batch = writeBatch(db);

    if (existingMod.exists()) {
      batch.update(modRef, {
        status: input.status,
        reason: cleanReason,
        moderatedBy: input.actor.uid,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(modRef, {
        uid: input.targetUid,
        status: input.status,
        reason: cleanReason,
        moderatedBy: input.actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const pubSnap = await getDoc(pubRef);
    if (pubSnap.exists()) {
      if (input.status === 'removed') {
        batch.delete(pubRef);
      } else if (input.status === 'active') {
        batch.update(pubRef, {
          isOnline: false,
          isDiscoverable: true,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(pubRef, {
          isOnline: false,
          isDiscoverable: false,
          updatedAt: serverTimestamp(),
        });
      }
    }

    await batch.commit();

    if (input.status === 'removed' && input.targetUsername) {
      try {
        await deleteDoc(doc(db, 'usernames', input.targetUsername));
      } catch {
        // Username might already be freed
      }
    }

    await logSystemActivity({
      action: `account_${input.status}`,
      actor: input.actor,
      targetId: input.targetUid,
      targetLabel: input.targetName,
      details: cleanReason || `Account status updated to ${input.status}.`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `accountModeration/${input.targetUid}`);
  }
}

export async function grantOrUpdateLimitedAdmin(input: {
  targetUid: string;
  email: string;
  displayName: string;
  role: Exclude<AdminRoleType, 'super_admin'>;
  permissions: AdminPermissions;
  actor: AuditActor;
}): Promise<void> {
  const adminRef = doc(db, 'admins', input.targetUid);
  try {
    const existing = await getDoc(adminRef);
    if (existing.exists()) {
      if (existing.data().role === 'super_admin') {
        throw new Error('Cannot alter the Super Admin role.');
      }
      await updateDoc(adminRef, {
        role: input.role,
        permissions: input.permissions,
        displayName: (input.displayName || 'Admin').slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(adminRef, {
        uid: input.targetUid,
        email: input.email.slice(0, 320),
        displayName: (input.displayName || 'Admin').slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
        role: input.role,
        permissions: input.permissions,
        grantedBy: input.actor.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await logSystemActivity({
      action: existing.exists() ? 'admin_role_updated' : 'admin_role_granted',
      actor: input.actor,
      targetId: input.targetUid,
      targetLabel: `${input.displayName} (${input.role})`,
      details: `Permissions: users=${input.permissions.viewUsers}, reports=${input.permissions.manageReports}, suspend=${input.permissions.suspendUsers}, settings=${input.permissions.manageSettings}, logs=${input.permissions.viewLogs}`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `admins/${input.targetUid}`);
  }
}

export async function revokeLimitedAdmin(input: {
  targetUid: string;
  targetName: string;
  actor: AuditActor;
}): Promise<void> {
  try {
    await deleteDoc(doc(db, 'admins', input.targetUid));
    await logSystemActivity({
      action: 'admin_role_revoked',
      actor: input.actor,
      targetId: input.targetUid,
      targetLabel: input.targetName,
      details: 'Revoked limited admin access.',
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `admins/${input.targetUid}`);
  }
}

export async function updateWebsiteSettings(input: {
  settings: Omit<WebsiteSettings, 'updatedBy' | 'updatedAt'>;
  actor: AuditActor;
}): Promise<void> {
  const settingsRef = doc(db, 'websiteSettings', 'global');
  try {
    const existing = await getDoc(settingsRef);
    const payload = {
      siteName:
        input.settings.siteName.trim().slice(0, BLUEPRINT_LIMITS.SITE_NAME_MAX) || 'VerdeChat',
      welcomeNotice: input.settings.welcomeNotice
        .trim()
        .slice(0, BLUEPRINT_LIMITS.WELCOME_NOTICE_MAX),
      moderationPolicySummary:
        input.settings.moderationPolicySummary.trim().slice(0, BLUEPRINT_LIMITS.POLICY_MAX) ||
        DEFAULT_MODERATION_POLICY,
      allowNewRegistrations: Boolean(input.settings.allowNewRegistrations),
      allowGroupCreation: Boolean(input.settings.allowGroupCreation),
      allowVoiceVideoCalls: Boolean(input.settings.allowVoiceVideoCalls),
      allowMediaUploads: Boolean(input.settings.allowMediaUploads),
      maintenanceMode: Boolean(input.settings.maintenanceMode),
      ownerMonitoringEnabled: input.settings.ownerMonitoringEnabled ?? true,
      allowPrivateContextReview: input.settings.allowPrivateContextReview ?? true,
      dataRetentionDays: Number(input.settings.dataRetentionDays ?? 365),
      updatedBy: input.actor.uid,
      updatedAt: serverTimestamp(),
    };

    if (existing.exists()) {
      await updateDoc(settingsRef, payload);
    } else {
      await setDoc(settingsRef, payload);
    }

    await logSystemActivity({
      action: 'website_settings_updated',
      actor: input.actor,
      targetId: 'global',
      targetLabel: payload.siteName,
      details: `Updated website settings (registrations=${payload.allowNewRegistrations}, maintenance=${payload.maintenanceMode}, retentionDays=${payload.dataRetentionDays}).`,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'websiteSettings/global');
  }
}
