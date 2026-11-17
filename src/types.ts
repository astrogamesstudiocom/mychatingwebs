import type { Timestamp } from 'firebase/firestore';

export const DESIGNATED_OWNER_EMAIL = 'fezinfezin42@gmail.com';
export const PRIVACY_POLICY_VERSION = '2026-11-owner-moderation-v1';

export const BLUEPRINT_LIMITS = {
  DISPLAY_NAME_MIN: 1,
  DISPLAY_NAME_MAX: 60,
  USERNAME_MIN: 3,
  USERNAME_MAX: 24,
  USERNAME_PATTERN: /^[a-z0-9_]{3,24}$/,
  ID_PATTERN: /^[a-zA-Z0-9_-]{1,128}$/,
  ABOUT_MAX: 140,
  CHAT_TITLE_MAX: 80,
  GROUP_DESCRIPTION_MAX: 200,
  MESSAGE_TEXT_MAX: 4000,
  LAST_MESSAGE_TEXT_MAX: 500,
  MEDIA_URL_MAX: 2000,
  MEDIA_NAME_MAX: 255,
  MAX_PARTICIPANTS: 20,
  REASON_MAX: 120,
  DETAILS_MAX: 1000,
  RESOLUTION_NOTE_MAX: 500,
  POLICY_MAX: 1000,
  SITE_NAME_MAX: 60,
  WELCOME_NOTICE_MAX: 300,
  LOG_DETAILS_MAX: 500,
} as const;

export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'call';
export type ChatType = 'direct' | 'group';
export type ChatCollection = 'chats' | 'groupChat';
export type CallType = 'audio' | 'video';
export type CallStatus = 'ringing' | 'answered' | 'ended' | 'declined' | 'missed';

export type AdminRoleType = 'super_admin' | 'moderator' | 'support_admin';
export type AccountModerationStatus = 'active' | 'suspended' | 'blocked' | 'removed';
export type ReportStatus = 'open' | 'under_review' | 'resolved' | 'dismissed';
export type ReportType = 'user' | 'message';

export interface UserPrivate {
  uid: string;
  email: string;
  displayName: string;
  username: string;
  fcmTokens: string[];
  notificationsEnabled: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PublicProfile {
  uid: string;
  displayName: string;
  username: string;
  photoURL: string;
  about: string;
  isOnline: boolean;
  isDiscoverable: boolean;
  lastSeen: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ChatThread {
  id: string;
  type: ChatType;
  title: string;
  description?: string;
  photoURL: string;
  participantIds: string[];
  adminIds?: string[];
  createdBy: string;
  lastMessageText: string;
  lastMessageType: MessageType;
  lastMessageSenderId: string;
  lastMessageAt: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  sourceCollection?: ChatCollection;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  participantIds: string[];
  type: MessageType;
  text: string;
  mediaUrl: string;
  mediaMimeType: string;
  mediaName: string;
  mediaDurationSec: number;
  readBy: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CallSession {
  id: string;
  callerId: string;
  callerName: string;
  callerPhoto: string;
  calleeId: string;
  calleeName: string;
  calleePhoto: string;
  chatId: string;
  participantIds: string[];
  callType: CallType;
  status: CallStatus;
  offerSdp: string;
  offerType: string;
  answerSdp: string;
  answerType: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OwnerConfig {
  ownerUid: string;
  ownerEmail: string;
  locked: boolean;
  configuredAt: Timestamp;
}

export interface AdminPermissions {
  viewUsers: boolean;
  manageReports: boolean;
  suspendUsers: boolean;
  manageSettings: boolean;
  viewLogs: boolean;
}

export interface AdminRecord {
  uid: string;
  email: string;
  displayName: string;
  role: AdminRoleType;
  permissions: AdminPermissions;
  grantedBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AccountModerationRecord {
  uid: string;
  status: AccountModerationStatus;
  reason: string;
  moderatedBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface ModerationReport {
  id: string;
  reportType: ReportType;
  reportedUid: string;
  reportedName: string;
  reportedByUid: string;
  reportedByName: string;
  chatId: string;
  chatCollection: '' | ChatCollection;
  messageId: string;
  messageTextSnippet: string;
  contextMessages: string[];
  reason: string;
  details: string;
  status: ReportStatus;
  resolutionNote: string;
  reviewedBy: string;
  userNoticeSent: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface WebsiteSettings {
  siteName: string;
  welcomeNotice: string;
  moderationPolicySummary: string;
  allowNewRegistrations: boolean;
  allowGroupCreation: boolean;
  allowVoiceVideoCalls: boolean;
  allowMediaUploads: boolean;
  maintenanceMode: boolean;
  ownerMonitoringEnabled?: boolean;
  allowPrivateContextReview?: boolean;
  dataRetentionDays?: number;
  updatedBy: string;
  updatedAt: Timestamp;
}

export interface UserPrivacyConsent {
  uid: string;
  consented: boolean;
  policyVersion: string;
  consentedAt: Timestamp;
  updatedAt: Timestamp;
}

export interface SystemStats {
  totalMessages: number;
  totalChats: number;
  totalGroupChats: number;
  totalCalls: number;
  updatedAt: Timestamp;
}

export interface SystemLogEntry {
  id: string;
  action: string;
  actorUid: string;
  actorName: string;
  actorRole: 'owner' | 'admin' | 'user';
  targetId: string;
  targetLabel: string;
  details: string;
  createdAt: Timestamp;
}

// Backend-verified Owner Dashboard API contracts
export interface OwnerUserRow {
  uid: string;
  displayName: string;
  username: string;
  email: string;
  photoURL: string;
  about: string;
  isOnline: boolean;
  isDiscoverable: boolean;
  moderationStatus: AccountModerationStatus;
  moderationReason: string;
  consented: boolean;
  policyVersion: string;
  consentedAt: string | null;
  createdAt: string | null;
  lastSeen: string | null;
}

export interface OwnerConversationParticipant {
  uid: string;
  displayName: string;
  username: string;
  photoURL: string;
  consented: boolean;
}

export interface OwnerConversationSummary {
  id: string;
  collection: ChatCollection;
  type: ChatType;
  title: string;
  description: string;
  participantIds: string[];
  participants: OwnerConversationParticipant[];
  createdBy: string;
  lastMessageText: string;
  lastMessageType: MessageType;
  lastMessageSenderId: string;
  lastMessageSenderName: string;
  lastMessageAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  messageCount: number;
  allParticipantsConsented: boolean;
}

export interface OwnerMessageRecord {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderUsername: string;
  receivers: Array<{ uid: string; displayName: string; username: string }>;
  type: MessageType;
  text: string;
  mediaUrl: string;
  mediaMimeType: string;
  mediaName: string;
  mediaDurationSec: number;
  readBy: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface OwnerReportRow {
  id: string;
  reportType: ReportType;
  reportedUid: string;
  reportedName: string;
  reportedByUid: string;
  reportedByName: string;
  chatId: string;
  chatCollection: '' | ChatCollection;
  messageId: string;
  messageTextSnippet: string;
  contextMessages: string[];
  reason: string;
  details: string;
  status: ReportStatus;
  resolutionNote: string;
  reviewedBy: string;
  userNoticeSent: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface OwnerLogRow {
  id: string;
  action: string;
  actorUid: string;
  actorName: string;
  actorRole: 'owner' | 'admin' | 'user';
  targetId: string;
  targetLabel: string;
  details: string;
  createdAt: string | null;
}

export interface OwnerRegistrationDayBucket {
  date: string;
  label: string;
  count: number;
}

export interface OwnerDashboardPayload {
  owner: {
    uid: string;
    email: string;
    ownerConfigured: boolean;
  };
  stats: {
    totalUsers: number;
    activeOnlineUsers: number;
    activeLast24hUsers: number;
    totalConversations: number;
    totalDirectChats: number;
    totalGroupChats: number;
    totalMessages: number;
    totalCalls: number;
    newUsers24h: number;
    newUsers7d: number;
    newUsers30d: number;
    consentedUsers: number;
    openReports: number;
    dailyRegistrations: OwnerRegistrationDayBucket[];
  };
  users: OwnerUserRow[];
  conversations: OwnerConversationSummary[];
  reports: OwnerReportRow[];
  logs: OwnerLogRow[];
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
    updatedBy: string;
    updatedAt: string | null;
  };
}
