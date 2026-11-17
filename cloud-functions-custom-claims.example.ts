/**
 * Reference Firebase Cloud Functions (2nd Gen) for Firebase Auth Custom Claims sync.
 * Note: This file is excluded from Vite/tsconfig browser compilation and can be deployed
 * via Firebase CLI (`firebase deploy --only functions`) if Firebase Cloud Functions is enabled.
 * Runtime RBAC & Super Admin enforcement in this app is handled directly by Firestore Security Rules
 * and Express `/api/admin/verify-owner`.
 */
/*
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp();

const DESIGNATED_OWNER_EMAIL = 'fezinfezin42@gmail.com';
const DATABASE_ID = 'ai-studio-74f731ac-af20-4811-a89d-31a8f86590fc';

export const syncAdminCustomClaims = onDocumentWritten(
  {
    document: 'admins/{userId}',
    database: DATABASE_ID,
  },
  async (event) => {
    const userId = event.params.userId;
    const afterData = event.data?.after.data();
    const auth = getAuth();

    if (!afterData) {
      await auth.setCustomUserClaims(userId, {});
      return;
    }

    await auth.setCustomUserClaims(userId, {
      admin: true,
      superAdmin: afterData.role === 'super_admin',
      adminRole: afterData.role,
      permissions: afterData.permissions || {},
    });
  }
);

export const initializeOwnerClaims = onCall(async (request) => {
  if (!request.auth || !request.auth.token.email_verified) {
    throw new HttpsError('unauthenticated', 'Verified authentication required.');
  }
  if (String(request.auth.token.email).toLowerCase() !== DESIGNATED_OWNER_EMAIL) {
    throw new HttpsError('permission-denied', 'Only the designated website owner can claim Super Admin.');
  }

  const db = getFirestore(DATABASE_ID);
  const ownerRef = db.doc('systemConfig/owner');
  const existing = await ownerRef.get();
  if (existing.exists && existing.data()?.ownerUid !== request.auth.uid) {
    throw new HttpsError('already-exists', 'Super Admin ownership is already locked.');
  }

  await getAuth().setCustomUserClaims(request.auth.uid, {
    admin: true,
    superAdmin: true,
    adminRole: 'super_admin',
  });

  if (!existing.exists) {
    await ownerRef.set({
      ownerUid: request.auth.uid,
      ownerEmail: DESIGNATED_OWNER_EMAIL,
      locked: true,
      configuredAt: FieldValue.serverTimestamp(),
    });
  }

  return { ok: true, ownerUid: request.auth.uid };
});
*/
export {};
