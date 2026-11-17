import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const OWNER_EMAIL = 'fezinfezin42@gmail.com';
const DEFAULT_MODERATION_POLICY =
  'For platform safety, abuse prevention, and community guideline enforcement, the verified Website Owner account (fezinfezin42@gmail.com) may review conversation history and reported messages when necessary for moderation. Ordinary users can never access other users’ private chats. Every administrative access to conversation history or reported messages is permanently recorded in an immutable security audit log.';

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  const candidates = [
    path.join(process.cwd(), 'firebase-applet-config.json'),
    process.env.LAMBDA_TASK_ROOT
      ? path.join(process.env.LAMBDA_TASK_ROOT, 'firebase-applet-config.json')
      : '',
    path.resolve(process.cwd(), '..', 'firebase-applet-config.json'),
    path.resolve(process.cwd(), '../..', 'firebase-applet-config.json'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, 'utf-8')) as FirebaseAppletConfig;
    }
  }
  throw new Error('Could not locate firebase-applet-config.json');
}

const firebaseConfig = loadFirebaseConfig();
const FIRESTORE_DOC_PREFIX = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;
const FIRESTORE_REST_BASE = `https://firestore.googleapis.com/v1/${FIRESTORE_DOC_PREFIX}`;

function resolveUploadDir(): string {
  const isServerless = Boolean(
    process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT
  );
  const preferred = isServerless
    ? path.join(os.tmpdir(), 'verdechat-uploads')
    : path.join(process.cwd(), '.uploads');
  if (!fs.existsSync(preferred)) {
    fs.mkdirSync(preferred, { recursive: true });
  }
  return preferred;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
};

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

function sanitizeExtension(mimeType: string, originalName: string): string {
  const baseMime = mimeType.split(';')[0].trim().toLowerCase();
  if (MIME_TO_EXT[baseMime]) {
    return MIME_TO_EXT[baseMime];
  }
  const ext = path.extname(originalName).toLowerCase();
  if (EXT_TO_MIME[ext]) {
    return ext;
  }
  return '.bin';
}

interface VerifiedTokenUser {
  localId: string;
  email: string;
  emailVerified: boolean;
}

interface VerifiedOwnerContext {
  uid: string;
  email: string;
  token: string;
  ownerConfigured: boolean;
  lockedOwnerUid: string | null;
}

interface OwnerRequest extends Request {
  verifiedOwner?: VerifiedOwnerContext;
}

type FirestoreRawValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  arrayValue?: { values?: FirestoreRawValue[] };
  mapValue?: { fields?: Record<string, FirestoreRawValue> };
};

interface FirestoreRawDoc {
  name: string;
  fields?: Record<string, FirestoreRawValue>;
}

function decodeFirestoreValue(val: FirestoreRawValue | undefined): unknown {
  if (!val) return null;
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return Number(val.integerValue);
  if (val.doubleValue !== undefined) return Number(val.doubleValue);
  if (val.booleanValue !== undefined) return Boolean(val.booleanValue);
  if (val.timestampValue !== undefined) return val.timestampValue;
  if (val.nullValue !== undefined) return null;
  if (val.arrayValue !== undefined) {
    return (val.arrayValue.values || []).map((item) => decodeFirestoreValue(item));
  }
  if (val.mapValue !== undefined) {
    return decodeFirestoreFields(val.mapValue.fields);
  }
  return null;
}

function decodeFirestoreFields(
  fields?: Record<string, FirestoreRawValue>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const [key, val] of Object.entries(fields)) {
    out[key] = decodeFirestoreValue(val);
  }
  return out;
}

function encodeFirestoreValue(val: unknown): FirestoreRawValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => encodeFirestoreValue(item)) } };
  }
  if (typeof val === 'object') {
    return { mapValue: { fields: encodeFirestoreFields(val as Record<string, unknown>) } };
  }
  return { stringValue: String(val) };
}

function encodeFirestoreFields(
  obj: Record<string, unknown>
): Record<string, FirestoreRawValue> {
  const fields: Record<string, FirestoreRawValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = encodeFirestoreValue(v);
    }
  }
  return fields;
}

function docIdFromName(name: string): string {
  const parts = name.split('/');
  return parts[parts.length - 1] || '';
}

function parseIsoMs(iso: unknown): number {
  if (typeof iso !== 'string' || !iso) return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function isValidId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedTokenUser | null> {
  const lookupUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
    firebaseConfig.apiKey
  )}`;
  const resp = await fetch(lookupUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!resp.ok) {
    return null;
  }
  const data = (await resp.json()) as {
    users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
  };
  const user = data.users?.[0];
  if (!user?.localId || !user?.email) {
    return null;
  }
  return {
    localId: user.localId,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
  };
}

async function getFirestoreDocAsUser(
  docPath: string,
  idToken: string
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const url = `${FIRESTORE_REST_BASE}/${docPath}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!resp.ok) {
    return null;
  }
  const raw = (await resp.json()) as FirestoreRawDoc;
  return {
    id: docIdFromName(raw.name),
    data: decodeFirestoreFields(raw.fields),
  };
}

async function listCollectionDocs(
  collectionPath: string,
  idToken: string,
  maskFields?: string[]
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const results: Array<{ id: string; data: Record<string, unknown> }> = [];
  let pageToken = '';

  for (let page = 0; page < 25; page++) {
    const params = new URLSearchParams({ pageSize: '500' });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }
    if (maskFields && maskFields.length > 0) {
      maskFields.forEach((f) => params.append('mask.fieldPaths', f));
    }

    const url = `${FIRESTORE_REST_BASE}/${collectionPath}?${params.toString()}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(
        `Firestore list failed for ${collectionPath} (${resp.status}): ${errText}`
      );
    }

    const payload = (await resp.json()) as {
      documents?: FirestoreRawDoc[];
      nextPageToken?: string;
    };

    for (const raw of payload.documents || []) {
      results.push({
        id: docIdFromName(raw.name),
        data: decodeFirestoreFields(raw.fields),
      });
    }

    if (!payload.nextPageToken) break;
    pageToken = payload.nextPageToken;
  }

  return results;
}

async function countConversationMessages(
  collectionName: 'chats' | 'groupChat',
  chatId: string,
  idToken: string
): Promise<number> {
  const aggUrl = `${FIRESTORE_REST_BASE}/${collectionName}/${encodeURIComponent(
    chatId
  )}:runAggregationQuery`;
  const resp = await fetch(aggUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: {
          from: [{ collectionId: 'messages' }],
        },
        aggregations: [{ alias: 'total', count: {} }],
      },
    }),
  });

  if (resp.ok) {
    const rows = (await resp.json()) as Array<{
      result?: { aggregateFields?: { total?: { integerValue?: string } } };
    }>;
    const rawCount = rows?.[0]?.result?.aggregateFields?.total?.integerValue;
    if (rawCount !== undefined) {
      return Number(rawCount) || 0;
    }
  }

  const docs = await listCollectionDocs(
    `${collectionName}/${encodeURIComponent(chatId)}/messages`,
    idToken,
    ['createdAt']
  );
  return docs.length;
}

interface FirestoreCommitWrite {
  update?: {
    name: string;
    fields: Record<string, FirestoreRawValue>;
  };
  delete?: string;
  updateMask?: { fieldPaths: string[] };
  currentDocument?: { exists: boolean };
  updateTransforms?: Array<{
    fieldPath: string;
    setToServerValue: 'REQUEST_TIME';
  }>;
}

async function commitFirestoreWrites(
  writes: FirestoreCommitWrite[],
  idToken: string
): Promise<void> {
  const url = `${FIRESTORE_REST_BASE}:commit`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Firestore commit failed (${resp.status}): ${errText}`);
  }
}

function buildSystemLogWrite(input: {
  logId: string;
  action: string;
  actorUid: string;
  actorName: string;
  targetId: string;
  targetLabel: string;
  details: string;
}): FirestoreCommitWrite {
  return {
    update: {
      name: `${FIRESTORE_DOC_PREFIX}/systemLogs/${input.logId}`,
      fields: encodeFirestoreFields({
        action: input.action.slice(0, 80),
        actorUid: input.actorUid,
        actorName: input.actorName.slice(0, 60),
        actorRole: 'owner',
        targetId: input.targetId.slice(0, 128),
        targetLabel: input.targetLabel.slice(0, 120),
        details: input.details.slice(0, 500),
      }),
    },
    currentDocument: { exists: false },
    updateTransforms: [
      { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
    ],
  };
}

async function requireVerifiedOwner(
  req: OwnerRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ authorized: false, error: 'Missing Authorization Bearer token' });
      return;
    }

    const verifiedUser = await verifyFirebaseIdToken(token);
    if (!verifiedUser) {
      res.status(401).json({ authorized: false, error: 'Invalid or expired Firebase ID token' });
      return;
    }

    if (!verifiedUser.emailVerified) {
      res.status(403).json({ authorized: false, error: 'Verified email required' });
      return;
    }

    if (verifiedUser.email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
      res.status(403).json({
        authorized: false,
        error: `Owner access is strictly restricted to ${OWNER_EMAIL}.`,
      });
      return;
    }

    const ownerDoc = await getFirestoreDocAsUser('systemConfig/owner', token);
    const lockedOwnerUid =
      typeof ownerDoc?.data.ownerUid === 'string' && ownerDoc.data.ownerUid
        ? ownerDoc.data.ownerUid
        : null;

    if (lockedOwnerUid !== null && lockedOwnerUid !== verifiedUser.localId) {
      res.status(403).json({
        authorized: false,
        error: 'UID mismatch with locked website owner configuration.',
      });
      return;
    }

    req.verifiedOwner = {
      uid: verifiedUser.localId,
      email: verifiedUser.email,
      token,
      ownerConfigured: lockedOwnerUid !== null,
      lockedOwnerUid,
    };
    next();
  } catch (err) {
    console.error('Owner verification error:', err);
    res.status(500).json({ authorized: false, error: 'Owner authorization check failed' });
  }
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'verdechat-web' });
  });

  const handleOwnerVerify = (req: OwnerRequest, res: Response) => {
    const owner = req.verifiedOwner!;
    res.json({
      authorized: true,
      uid: owner.uid,
      ownerEmail: owner.email,
      isSuperAdmin: true,
      ownerConfigured: owner.ownerConfigured,
    });
  };

  router.post('/owner/verify', express.json(), requireVerifiedOwner, handleOwnerVerify);
  router.post('/admin/verify-owner', express.json(), requireVerifiedOwner, handleOwnerVerify);

  router.get('/owner/dashboard', requireVerifiedOwner, async (req: OwnerRequest, res: Response) => {
    try {
      const owner = req.verifiedOwner!;
      const [
        privateUsersDocs,
        publicProfileDocs,
        moderationDocs,
        consentDocs,
        directChatDocs,
        groupChatDocs,
        reportDocs,
        logDocs,
        settingsDoc,
        statsDoc,
      ] = await Promise.all([
        listCollectionDocs('users', owner.token).catch(() => []),
        listCollectionDocs('publicProfiles', owner.token),
        listCollectionDocs('accountModeration', owner.token).catch(() => []),
        listCollectionDocs('userPrivacyConsents', owner.token).catch(() => []),
        listCollectionDocs('chats', owner.token),
        listCollectionDocs('groupChat', owner.token).catch(() => []),
        listCollectionDocs('reports', owner.token).catch(() => []),
        listCollectionDocs('systemLogs', owner.token).catch(() => []),
        getFirestoreDocAsUser('websiteSettings/global', owner.token),
        getFirestoreDocAsUser('systemStats/overview', owner.token),
      ]);

      const privMap = new Map<string, Record<string, unknown>>();
      for (const d of privateUsersDocs) privMap.set(d.id, d.data);

      const pubMap = new Map<string, Record<string, unknown>>();
      for (const d of publicProfileDocs) pubMap.set(d.id, d.data);

      const modMap = new Map<string, Record<string, unknown>>();
      for (const d of moderationDocs) modMap.set(d.id, d.data);

      const consentMap = new Map<string, Record<string, unknown>>();
      for (const d of consentDocs) consentMap.set(d.id, d.data);

      const allUids = new Set<string>([
        ...privMap.keys(),
        ...pubMap.keys(),
      ]);

      const nowMs = Date.now();
      const ms24h = 24 * 60 * 60 * 1000;
      const ms7d = 7 * ms24h;
      const ms30d = 30 * ms24h;

      const users = Array.from(allUids)
        .map((uid) => {
          const priv = privMap.get(uid);
          const pub = pubMap.get(uid);
          const mod = modMap.get(uid);
          const consent = consentMap.get(uid);
          const moderationStatus = String(mod?.status || 'active');
          const createdAt =
            (typeof priv?.createdAt === 'string' && priv.createdAt) ||
            (typeof pub?.createdAt === 'string' && pub.createdAt) ||
            null;
          const lastSeen = typeof pub?.lastSeen === 'string' ? pub.lastSeen : null;
          return {
            uid,
            displayName: String(pub?.displayName || priv?.displayName || 'User'),
            username: String(pub?.username || priv?.username || 'user'),
            email: String(priv?.email || ''),
            photoURL: String(pub?.photoURL || ''),
            about: String(pub?.about || ''),
            isOnline: Boolean(pub?.isOnline) && moderationStatus === 'active',
            isDiscoverable: Boolean(pub?.isDiscoverable ?? true),
            moderationStatus,
            moderationReason: String(mod?.reason || ''),
            consented: Boolean(consent?.consented),
            policyVersion: String(consent?.policyVersion || ''),
            consentedAt: typeof consent?.consentedAt === 'string' ? consent.consentedAt : null,
            createdAt,
            lastSeen,
          };
        })
        .sort((a, b) => parseIsoMs(b.createdAt) - parseIsoMs(a.createdAt));

      const userByUid = new Map(users.map((u) => [u.uid, u]));

      const dayBuckets: Array<{ date: string; label: string; count: number }> = [];
      const bucketMap = new Map<string, { date: string; label: string; count: number }>();
      for (let i = 13; i >= 0; i--) {
        const dt = new Date(nowMs - i * ms24h);
        const dateKey = dt.toISOString().slice(0, 10);
        const label = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const bucket = { date: dateKey, label, count: 0 };
        dayBuckets.push(bucket);
        bucketMap.set(dateKey, bucket);
      }

      let activeOnlineUsers = 0;
      let activeLast24hUsers = 0;
      let newUsers24h = 0;
      let newUsers7d = 0;
      let newUsers30d = 0;
      let consentedUsers = 0;

      for (const u of users) {
        if (u.isOnline) activeOnlineUsers++;
        const lastSeenMs = parseIsoMs(u.lastSeen);
        if (u.moderationStatus === 'active' && (u.isOnline || (lastSeenMs > 0 && nowMs - lastSeenMs <= ms24h))) {
          activeLast24hUsers++;
        }
        if (u.consented) consentedUsers++;

        const createdMs = parseIsoMs(u.createdAt);
        if (createdMs > 0) {
          const age = nowMs - createdMs;
          if (age <= ms24h) newUsers24h++;
          if (age <= ms7d) newUsers7d++;
          if (age <= ms30d) newUsers30d++;
          const key = new Date(createdMs).toISOString().slice(0, 10);
          const bucket = bucketMap.get(key);
          if (bucket) bucket.count++;
        }
      }

      const allChatRefs: Array<{
        collection: 'chats' | 'groupChat';
        doc: { id: string; data: Record<string, unknown> };
      }> = [
        ...directChatDocs.map((doc) => ({ collection: 'chats' as const, doc })),
        ...groupChatDocs.map((doc) => ({ collection: 'groupChat' as const, doc })),
      ];

      const messageCountMap = new Map<string, number>();
      let realTotalMessages = 0;
      for (let i = 0; i < allChatRefs.length; i += 10) {
        const slice = allChatRefs.slice(i, i + 10);
        const counts = await Promise.all(
          slice.map(async ({ collection, doc }) => {
            try {
              return await countConversationMessages(collection, doc.id, owner.token);
            } catch {
              return 0;
            }
          })
        );
        slice.forEach(({ collection, doc }, idx) => {
          const c = counts[idx] || 0;
          messageCountMap.set(`${collection}:${doc.id}`, c);
          realTotalMessages += c;
        });
      }

      const conversations = allChatRefs
        .map(({ collection, doc }) => {
          const d = doc.data;
          const participantIds = Array.isArray(d.participantIds)
            ? d.participantIds.map((p) => String(p))
            : [];
          const participants = participantIds.map((uid) => {
            const u = userByUid.get(uid);
            return {
              uid,
              displayName: u?.displayName || 'Unknown User',
              username: u?.username || uid.slice(0, 8),
              photoURL: u?.photoURL || '',
              consented: Boolean(u?.consented),
            };
          });
          const lastMessageSenderId = String(d.lastMessageSenderId || '');
          const lastSender = lastMessageSenderId ? userByUid.get(lastMessageSenderId) : undefined;
          const type =
            collection === 'groupChat'
              ? 'group'
              : String(d.type || 'direct') === 'group'
              ? 'group'
              : 'direct';

          return {
            id: doc.id,
            collection,
            type,
            title: String(d.title || ''),
            description: String(d.description || ''),
            participantIds,
            participants,
            createdBy: String(d.createdBy || ''),
            lastMessageText: String(d.lastMessageText || ''),
            lastMessageType: String(d.lastMessageType || 'text'),
            lastMessageSenderId,
            lastMessageSenderName: lastSender?.displayName || (lastMessageSenderId ? 'User' : ''),
            lastMessageAt: typeof d.lastMessageAt === 'string' ? d.lastMessageAt : null,
            createdAt: typeof d.createdAt === 'string' ? d.createdAt : null,
            updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : null,
            messageCount: messageCountMap.get(`${collection}:${doc.id}`) ?? 0,
            allParticipantsConsented:
              participants.length > 0 && participants.every((p) => p.consented),
          };
        })
        .sort(
          (a, b) =>
            (parseIsoMs(b.lastMessageAt) || parseIsoMs(b.createdAt)) -
            (parseIsoMs(a.lastMessageAt) || parseIsoMs(a.createdAt))
        );

      const reports = reportDocs
        .map((r) => ({
          id: r.id,
          reportType: String(r.data.reportType || 'user'),
          reportedUid: String(r.data.reportedUid || ''),
          reportedName: String(r.data.reportedName || ''),
          reportedByUid: String(r.data.reportedByUid || ''),
          reportedByName: String(r.data.reportedByName || ''),
          chatId: String(r.data.chatId || ''),
          chatCollection: String(r.data.chatCollection || ''),
          messageId: String(r.data.messageId || ''),
          messageTextSnippet: String(r.data.messageTextSnippet || ''),
          contextMessages: Array.isArray(r.data.contextMessages)
            ? r.data.contextMessages.map((m) => String(m))
            : [],
          reason: String(r.data.reason || ''),
          details: String(r.data.details || ''),
          status: String(r.data.status || 'open'),
          resolutionNote: String(r.data.resolutionNote || ''),
          reviewedBy: String(r.data.reviewedBy || ''),
          userNoticeSent: Boolean(r.data.userNoticeSent),
          createdAt: typeof r.data.createdAt === 'string' ? r.data.createdAt : null,
          updatedAt: typeof r.data.updatedAt === 'string' ? r.data.updatedAt : null,
        }))
        .sort((a, b) => parseIsoMs(b.createdAt) - parseIsoMs(a.createdAt));

      const logs = logDocs
        .map((l) => ({
          id: l.id,
          action: String(l.data.action || ''),
          actorUid: String(l.data.actorUid || ''),
          actorName: String(l.data.actorName || ''),
          actorRole: String(l.data.actorRole || 'user'),
          targetId: String(l.data.targetId || ''),
          targetLabel: String(l.data.targetLabel || ''),
          details: String(l.data.details || ''),
          createdAt: typeof l.data.createdAt === 'string' ? l.data.createdAt : null,
        }))
        .sort((a, b) => parseIsoMs(b.createdAt) - parseIsoMs(a.createdAt))
        .slice(0, 300);

      const s = settingsDoc?.data || {};
      const openReports = reports.filter(
        (r) => r.status === 'open' || r.status === 'under_review'
      ).length;

      res.json({
        owner: {
          uid: owner.uid,
          email: owner.email,
          ownerConfigured: owner.ownerConfigured,
        },
        stats: {
          totalUsers: users.length,
          activeOnlineUsers,
          activeLast24hUsers,
          totalConversations: conversations.length,
          totalDirectChats: directChatDocs.length,
          totalGroupChats: groupChatDocs.length,
          totalMessages: realTotalMessages,
          totalCalls: Number(statsDoc?.data.totalCalls ?? 0),
          newUsers24h,
          newUsers7d,
          newUsers30d,
          consentedUsers,
          openReports,
          dailyRegistrations: dayBuckets,
        },
        users,
        conversations,
        reports,
        logs,
        settings: {
          siteName: String(s.siteName || 'VerdeChat'),
          welcomeNotice: String(s.welcomeNotice || ''),
          moderationPolicySummary: String(s.moderationPolicySummary || DEFAULT_MODERATION_POLICY),
          allowNewRegistrations: Boolean(s.allowNewRegistrations ?? true),
          allowGroupCreation: Boolean(s.allowGroupCreation ?? true),
          allowVoiceVideoCalls: Boolean(s.allowVoiceVideoCalls ?? true),
          allowMediaUploads: Boolean(s.allowMediaUploads ?? true),
          maintenanceMode: Boolean(s.maintenanceMode ?? false),
          ownerMonitoringEnabled: Boolean(s.ownerMonitoringEnabled ?? true),
          allowPrivateContextReview: Boolean(s.allowPrivateContextReview ?? true),
          dataRetentionDays: Number(s.dataRetentionDays ?? 365),
          updatedBy: String(s.updatedBy || ''),
          updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null,
        },
      });
    } catch (err) {
      console.error('Failed to load owner dashboard:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load owner dashboard data.',
      });
    }
  });

  router.post(
    '/owner/conversations/:collection/:chatId/access',
    express.json(),
    requireVerifiedOwner,
    async (req: OwnerRequest, res: Response) => {
      try {
        const owner = req.verifiedOwner!;
        const collectionName = req.params.collection;
        const chatId = req.params.chatId;
        const reason = String((req.body as { reason?: string })?.reason || '').trim();

        if (collectionName !== 'chats' && collectionName !== 'groupChat') {
          res.status(400).json({ error: 'Invalid conversation collection' });
          return;
        }
        if (!isValidId(chatId)) {
          res.status(400).json({ error: 'Invalid conversation ID' });
          return;
        }
        if (reason.length < 3) {
          res.status(400).json({
            error: 'A clear moderation or safety reason (min 3 characters) is required to audit-log conversation access.',
          });
          return;
        }

        const settingsDoc = await getFirestoreDocAsUser('websiteSettings/global', owner.token);
        if (
          settingsDoc?.data.ownerMonitoringEnabled === false ||
          settingsDoc?.data.allowPrivateContextReview === false
        ) {
          res.status(403).json({
            error: 'Private conversation review is currently paused in Website Privacy Settings.',
          });
          return;
        }

        const chatDoc = await getFirestoreDocAsUser(
          `${collectionName}/${encodeURIComponent(chatId)}`,
          owner.token
        );
        if (!chatDoc) {
          res.status(404).json({ error: 'Conversation not found' });
          return;
        }

        const participantIds = Array.isArray(chatDoc.data.participantIds)
          ? chatDoc.data.participantIds.map((p) => String(p))
          : [];

        const [pubDocs, consentDocs] = await Promise.all([
          listCollectionDocs('publicProfiles', owner.token).catch(() => []),
          listCollectionDocs('userPrivacyConsents', owner.token).catch(() => []),
        ]);

        const pubMap = new Map(pubDocs.map((d) => [d.id, d.data]));
        const consentMap = new Map(consentDocs.map((d) => [d.id, d.data]));

        const participants = participantIds.map((uid) => {
          const p = pubMap.get(uid);
          const c = consentMap.get(uid);
          return {
            uid,
            displayName: String(p?.displayName || 'User'),
            username: String(p?.username || uid.slice(0, 8)),
            photoURL: String(p?.photoURL || ''),
            consented: Boolean(c?.consented),
          };
        });
        const participantByUid = new Map(participants.map((p) => [p.uid, p]));

        const targetLabel =
          collectionName === 'groupChat' || chatDoc.data.type === 'group'
            ? String(chatDoc.data.title || `Group (${chatId})`)
            : participants.map((p) => `@${p.username}`).join(' <-> ') || chatId;

        const auditLogId = `log_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        await commitFirestoreWrites(
          [
            buildSystemLogWrite({
              logId: auditLogId,
              action: 'owner_conversation_accessed',
              actorUid: owner.uid,
              actorName: owner.email,
              targetId: `${collectionName}/${chatId}`,
              targetLabel,
              details: `Owner reviewed conversation history (${targetLabel}). Reason: ${reason}`,
            }),
          ],
          owner.token
        );

        const messageDocs = await listCollectionDocs(
          `${collectionName}/${encodeURIComponent(chatId)}/messages`,
          owner.token
        );

        const messages = messageDocs
          .map((m) => {
            const d = m.data;
            const senderId = String(d.senderId || '');
            const senderProfile = participantByUid.get(senderId);
            const receivers = participants
              .filter((p) => p.uid !== senderId)
              .map((p) => ({
                uid: p.uid,
                displayName: p.displayName,
                username: p.username,
              }));

            return {
              id: m.id,
              chatId: String(d.chatId || chatId),
              senderId,
              senderName: String(d.senderName || senderProfile?.displayName || 'User'),
              senderUsername: senderProfile?.username || senderId.slice(0, 8),
              receivers,
              type: String(d.type || 'text'),
              text: String(d.text || ''),
              mediaUrl: String(d.mediaUrl || ''),
              mediaMimeType: String(d.mediaMimeType || ''),
              mediaName: String(d.mediaName || ''),
              mediaDurationSec: Number(d.mediaDurationSec ?? 0),
              readBy: Array.isArray(d.readBy) ? d.readBy.map((id) => String(id)) : [],
              createdAt: typeof d.createdAt === 'string' ? d.createdAt : null,
              updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : null,
            };
          })
          .sort((a, b) => parseIsoMs(a.createdAt) - parseIsoMs(b.createdAt));

        const lastSenderId = String(chatDoc.data.lastMessageSenderId || '');
        const lastSender = participantByUid.get(lastSenderId);

        res.json({
          auditLogId,
          accessedAt: new Date().toISOString(),
          conversation: {
            id: chatId,
            collection: collectionName,
            type: collectionName === 'groupChat' || chatDoc.data.type === 'group' ? 'group' : 'direct',
            title: String(chatDoc.data.title || ''),
            description: String(chatDoc.data.description || ''),
            participantIds,
            participants,
            createdBy: String(chatDoc.data.createdBy || ''),
            lastMessageText: String(chatDoc.data.lastMessageText || ''),
            lastMessageType: String(chatDoc.data.lastMessageType || 'text'),
            lastMessageSenderId: lastSenderId,
            lastMessageSenderName: lastSender?.displayName || '',
            lastMessageAt:
              typeof chatDoc.data.lastMessageAt === 'string' ? chatDoc.data.lastMessageAt : null,
            createdAt: typeof chatDoc.data.createdAt === 'string' ? chatDoc.data.createdAt : null,
            updatedAt: typeof chatDoc.data.updatedAt === 'string' ? chatDoc.data.updatedAt : null,
            messageCount: messages.length,
            allParticipantsConsented:
              participants.length > 0 && participants.every((p) => p.consented),
          },
          messages,
        });
      } catch (err) {
        console.error('Owner conversation access failed:', err);
        res.status(500).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to audit-log and retrieve conversation history.',
        });
      }
    }
  );

  router.post(
    '/owner/users/:targetUid/moderate',
    express.json(),
    requireVerifiedOwner,
    async (req: OwnerRequest, res: Response) => {
      try {
        const owner = req.verifiedOwner!;
        const targetUid = req.params.targetUid;
        const body = req.body as { status?: string; reason?: string };
        const status = String(body.status || '');
        const reason = String(body.reason || '').trim().slice(0, 500);

        if (!isValidId(targetUid)) {
          res.status(400).json({ error: 'Invalid user ID' });
          return;
        }
        if (targetUid === owner.uid || targetUid === owner.lockedOwnerUid) {
          res.status(400).json({ error: 'The authorized Website Owner account cannot be moderated.' });
          return;
        }
        if (!['active', 'suspended', 'blocked', 'removed'].includes(status)) {
          res.status(400).json({ error: 'Invalid moderation status' });
          return;
        }

        const [existingMod, pubDoc] = await Promise.all([
          getFirestoreDocAsUser(`accountModeration/${encodeURIComponent(targetUid)}`, owner.token),
          getFirestoreDocAsUser(`publicProfiles/${encodeURIComponent(targetUid)}`, owner.token),
        ]);

        const targetName = String(pubDoc?.data.displayName || targetUid);
        const targetUsername = String(pubDoc?.data.username || '');

        const writes: FirestoreCommitWrite[] = [];

        if (existingMod) {
          writes.push({
            update: {
              name: `${FIRESTORE_DOC_PREFIX}/accountModeration/${targetUid}`,
              fields: encodeFirestoreFields({
                status,
                reason,
                moderatedBy: owner.uid,
              }),
            },
            updateMask: { fieldPaths: ['status', 'reason', 'moderatedBy'] },
            currentDocument: { exists: true },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
          });
        } else {
          writes.push({
            update: {
              name: `${FIRESTORE_DOC_PREFIX}/accountModeration/${targetUid}`,
              fields: encodeFirestoreFields({
                uid: targetUid,
                status,
                reason,
                moderatedBy: owner.uid,
              }),
            },
            currentDocument: { exists: false },
            updateTransforms: [
              { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
              { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
            ],
          });
        }

        if (pubDoc) {
          if (status === 'removed') {
            writes.push({
              delete: `${FIRESTORE_DOC_PREFIX}/publicProfiles/${targetUid}`,
            });
            if (targetUsername && /^[a-z0-9_]{3,24}$/.test(targetUsername)) {
              writes.push({
                delete: `${FIRESTORE_DOC_PREFIX}/usernames/${targetUsername}`,
              });
            }
          } else {
            writes.push({
              update: {
                name: `${FIRESTORE_DOC_PREFIX}/publicProfiles/${targetUid}`,
                fields: encodeFirestoreFields({
                  isOnline: false,
                  isDiscoverable: status === 'active',
                }),
              },
              updateMask: { fieldPaths: ['isOnline', 'isDiscoverable'] },
              currentDocument: { exists: true },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            });
          }
        }

        writes.push(
          buildSystemLogWrite({
            logId: `log_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
            action: `account_${status}`,
            actorUid: owner.uid,
            actorName: owner.email,
            targetId: targetUid,
            targetLabel: targetUsername ? `${targetName} (@${targetUsername})` : targetName,
            details: reason || `Owner set account status to ${status}.`,
          })
        );

        await commitFirestoreWrites(writes, owner.token);
        res.json({ ok: true, status });
      } catch (err) {
        console.error('Owner user moderation failed:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to moderate user account.',
        });
      }
    }
  );

  router.post(
    '/owner/reports/:reportId/access',
    express.json(),
    requireVerifiedOwner,
    async (req: OwnerRequest, res: Response) => {
      try {
        const owner = req.verifiedOwner!;
        const reportId = req.params.reportId;
        const reason = String((req.body as { reason?: string })?.reason || '').trim().slice(0, 500);

        if (!isValidId(reportId)) {
          res.status(400).json({ error: 'Invalid report ID' });
          return;
        }
        if (reason.length < 3) {
          res.status(400).json({
            error: 'A moderation reason (min 3 characters) is required before opening reported content.',
          });
          return;
        }

        const reportDoc = await getFirestoreDocAsUser(
          `reports/${encodeURIComponent(reportId)}`,
          owner.token
        );
        if (!reportDoc) {
          res.status(404).json({ error: 'Report not found' });
          return;
        }

        const auditLogId = `log_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        await commitFirestoreWrites(
          [
            {
              update: {
                name: `${FIRESTORE_DOC_PREFIX}/reports/${reportId}`,
                fields: encodeFirestoreFields({
                  status: 'under_review',
                  resolutionNote: reason,
                  reviewedBy: owner.uid,
                  userNoticeSent: true,
                }),
              },
              updateMask: {
                fieldPaths: ['status', 'resolutionNote', 'reviewedBy', 'userNoticeSent'],
              },
              currentDocument: { exists: true },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            buildSystemLogWrite({
              logId: auditLogId,
              action: 'report_message_accessed',
              actorUid: owner.uid,
              actorName: owner.email,
              targetId: reportId,
              targetLabel: String(reportDoc.data.reportedName || reportId),
              details: `Owner opened reported message context with user notice. Reason: ${reason}`,
            }),
          ],
          owner.token
        );

        res.json({
          auditLogId,
          report: {
            id: reportId,
            ...reportDoc.data,
            status: 'under_review',
            resolutionNote: reason,
            reviewedBy: owner.uid,
            userNoticeSent: true,
          },
        });
      } catch (err) {
        console.error('Owner report access failed:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to access report context.',
        });
      }
    }
  );

  router.post(
    '/owner/reports/:reportId/resolve',
    express.json(),
    requireVerifiedOwner,
    async (req: OwnerRequest, res: Response) => {
      try {
        const owner = req.verifiedOwner!;
        const reportId = req.params.reportId;
        const body = req.body as { status?: string; resolutionNote?: string };
        const status = String(body.status || '');
        const resolutionNote = String(body.resolutionNote || '').trim().slice(0, 500);

        if (!isValidId(reportId)) {
          res.status(400).json({ error: 'Invalid report ID' });
          return;
        }
        if (status !== 'resolved' && status !== 'dismissed') {
          res.status(400).json({ error: 'Resolution status must be resolved or dismissed' });
          return;
        }

        const reportDoc = await getFirestoreDocAsUser(
          `reports/${encodeURIComponent(reportId)}`,
          owner.token
        );
        if (!reportDoc) {
          res.status(404).json({ error: 'Report not found' });
          return;
        }

        await commitFirestoreWrites(
          [
            {
              update: {
                name: `${FIRESTORE_DOC_PREFIX}/reports/${reportId}`,
                fields: encodeFirestoreFields({
                  status,
                  resolutionNote: resolutionNote || `Marked as ${status}`,
                  reviewedBy: owner.uid,
                  userNoticeSent: true,
                }),
              },
              updateMask: {
                fieldPaths: ['status', 'resolutionNote', 'reviewedBy', 'userNoticeSent'],
              },
              currentDocument: { exists: true },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            },
            buildSystemLogWrite({
              logId: `log_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
              action: `report_${status}`,
              actorUid: owner.uid,
              actorName: owner.email,
              targetId: reportId,
              targetLabel: String(reportDoc.data.reportedName || reportId),
              details: resolutionNote || `Owner marked report as ${status}.`,
            }),
          ],
          owner.token
        );

        res.json({ ok: true, status });
      } catch (err) {
        console.error('Owner report resolve failed:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to resolve report.',
        });
      }
    }
  );

  router.put(
    '/owner/settings',
    express.json(),
    requireVerifiedOwner,
    async (req: OwnerRequest, res: Response) => {
      try {
        const owner = req.verifiedOwner!;
        const body = req.body as Record<string, unknown>;
        const siteName = String(body.siteName || 'VerdeChat').trim().slice(0, 60) || 'VerdeChat';
        const welcomeNotice = String(body.welcomeNotice || '').trim().slice(0, 300);
        const moderationPolicySummary =
          String(body.moderationPolicySummary || '').trim().slice(0, 1000) ||
          DEFAULT_MODERATION_POLICY;
        const allowNewRegistrations = Boolean(body.allowNewRegistrations ?? true);
        const allowGroupCreation = Boolean(body.allowGroupCreation ?? true);
        const allowVoiceVideoCalls = Boolean(body.allowVoiceVideoCalls ?? true);
        const allowMediaUploads = Boolean(body.allowMediaUploads ?? true);
        const maintenanceMode = Boolean(body.maintenanceMode ?? false);
        const ownerMonitoringEnabled = Boolean(body.ownerMonitoringEnabled ?? true);
        const allowPrivateContextReview = Boolean(body.allowPrivateContextReview ?? true);
        const rawDays = Math.round(Number(body.dataRetentionDays ?? 365));
        const dataRetentionDays = Math.min(3650, Math.max(1, Number.isFinite(rawDays) ? rawDays : 365));

        const existingSettings = await getFirestoreDocAsUser('websiteSettings/global', owner.token);

        const settingsFields = encodeFirestoreFields({
          siteName,
          welcomeNotice,
          moderationPolicySummary,
          allowNewRegistrations,
          allowGroupCreation,
          allowVoiceVideoCalls,
          allowMediaUploads,
          maintenanceMode,
          ownerMonitoringEnabled,
          allowPrivateContextReview,
          dataRetentionDays,
          updatedBy: owner.uid,
        });

        const settingsWrite: FirestoreCommitWrite = existingSettings
          ? {
              update: {
                name: `${FIRESTORE_DOC_PREFIX}/websiteSettings/global`,
                fields: settingsFields,
              },
              updateMask: {
                fieldPaths: [
                  'siteName',
                  'welcomeNotice',
                  'moderationPolicySummary',
                  'allowNewRegistrations',
                  'allowGroupCreation',
                  'allowVoiceVideoCalls',
                  'allowMediaUploads',
                  'maintenanceMode',
                  'ownerMonitoringEnabled',
                  'allowPrivateContextReview',
                  'dataRetentionDays',
                  'updatedBy',
                ],
              },
              currentDocument: { exists: true },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            }
          : {
              update: {
                name: `${FIRESTORE_DOC_PREFIX}/websiteSettings/global`,
                fields: settingsFields,
              },
              currentDocument: { exists: false },
              updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            };

        await commitFirestoreWrites(
          [
            settingsWrite,
            buildSystemLogWrite({
              logId: `log_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
              action: 'website_settings_updated',
              actorUid: owner.uid,
              actorName: owner.email,
              targetId: 'global',
              targetLabel: siteName,
              details: `Updated privacy & platform settings (monitoring=${ownerMonitoringEnabled}, contextReview=${allowPrivateContextReview}, retentionDays=${dataRetentionDays}, maintenance=${maintenanceMode}).`,
            }),
          ],
          owner.token
        );

        res.json({ ok: true });
      } catch (err) {
        console.error('Owner settings update failed:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to update website settings.',
        });
      }
    }
  );

  router.post(
    '/media/upload',
    express.raw({ type: '*/*', limit: '50mb' }),
    (req, res) => {
      try {
        const buffer = req.body;
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
          res.status(400).json({ error: 'Empty media payload' });
          return;
        }

        const contentTypeHeader = String(req.headers['content-type'] || 'application/octet-stream');
        const originalName = String(req.headers['x-file-name'] || 'upload');
        const ext = sanitizeExtension(contentTypeHeader, originalName);
        if (ext === '.bin') {
          res.status(415).json({ error: 'Unsupported media format' });
          return;
        }

        const uploadDir = resolveUploadDir();
        const fileId = `${Date.now()}-${crypto.randomUUID()}${ext}`;
        const filePath = path.join(uploadDir, fileId);
        fs.writeFileSync(filePath, buffer);

        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const url = host ? `${protocol}://${host}/api/media/${fileId}` : `/api/media/${fileId}`;

        res.status(201).json({
          url,
          fileId,
          size: buffer.length,
          mimeType: contentTypeHeader.split(';')[0].trim(),
        });
      } catch (err) {
        console.error('Media upload failed:', err);
        res.status(500).json({ error: 'Failed to store uploaded media' });
      }
    }
  );

  router.get('/media/:fileId', (req, res) => {
    const fileId = path.basename(req.params.fileId);
    if (!/^[a-zA-Z0-9._-]+$/.test(fileId)) {
      res.status(400).json({ error: 'Invalid media ID' });
      return;
    }

    const uploadDir = resolveUploadDir();
    const filePath = path.join(uploadDir, fileId);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Media not found' });
      return;
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(fileId).toLowerCase();
    const mimeType = EXT_TO_MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      if (Number.isNaN(start) || start >= stat.size || end >= stat.size || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
        return;
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': mimeType,
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // Catch-all for unknown API paths so API requests never fall through to SPA HTML
  router.use((_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  return router;
}

export function createApiApp(options?: { mountRootFallback?: boolean }): express.Express {
  const app = express();
  const apiRouter = createApiRouter();

  app.use('/api', apiRouter);
  app.use('/.netlify/functions/api', apiRouter);

  if (options?.mountRootFallback) {
    app.use('/', apiRouter);
  }

  return app;
}
