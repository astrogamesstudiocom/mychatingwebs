# Security Specification & Red-Team Threat Model

## 1. Data Invariants
1. **PII Isolation**: User email addresses and FCM notification tokens live exclusively in `/users/{userId}`, readable and writable by the owning UID (`request.auth.uid == userId`), and readable strictly by the verified Website Owner (`fezinfezin42@gmail.com` + locked `ownerUid`). Non-PII chat directory info lives separately in `/publicProfiles/{userId}`.
2. **Master Gate Chat Membership & Owner-Only Moderation Access**: A message in `/chats/{chatId}/messages/{messageId}` or `/groupChat/{groupId}/messages/{messageId}` cannot be created unless the parent document exists, `request.auth.uid` is in `participantIds`, the user is not suspended/banned/removed in `/accountModeration/{uid}`, and `participantIds` exactly matches the parent chat's `participantIds`. Ordinary users can NEVER read or list other users' private chats or messages. Only the verified Website Owner (`isSuperAdmin()`) may read conversations for safety moderation via audit-logged backend endpoints.
3. **One-Time Super Admin Ownership Binding**: `/systemConfig/owner` can only be created once (`!exists(...)`) by the designated verified owner (`fezinfezin42@gmail.com` with `email_verified == true`), binding `ownerUid` to their Firebase Auth UID, and is immutable (`update, delete: if false`). `isSuperAdmin()` always verifies BOTH `request.auth.token.email == 'fezinfezin42@gmail.com'` with `email_verified == true` AND matching `ownerUid` if configured. Nobody else can ever become an owner.
4. **Privilege Escalation Prevention**: Regular users cannot create or modify `/admins/{uid}`, `/accountModeration/{uid}`, `/websiteSettings/global`, or inject role fields on `/users/{uid}` or `/publicProfiles/{uid}`. Only the verified Website Owner can moderate accounts (`active`, `suspended`, `blocked`, `removed`), update settings, or access Owner APIs.
5. **User Privacy Disclosure & Consent Integrity**: `/userPrivacyConsents/{userId}` can only be created or updated by `request.auth.uid == userId` with `consented == true`, valid `policyVersion`, and `request.time` timestamps. Users cannot forge another user's consent or delete their consent record.
6. **Sender & Actor Identity Integrity**: Users cannot forge `senderId`, `callerId`, `createdBy`, `reportedByUid`, or `actorUid`.
7. **Terminal State Locking**: Once a WebRTC call session in `/calls/{callId}` transitions to `'ended'`, `'declined'`, or `'missed'`, no further updates are permitted.
8. **Temporal & Audit Immutability**: All `createdAt`, `configuredAt`, `consentedAt`, and `updatedAt` fields must equal `request.time`. System audit logs in `/systemLogs/{logId}`—including every `owner_conversation_accessed` and `report_message_accessed` log—are strictly append-only (`update, delete: if false`) and readable only by the verified Owner.

## 2. The "Dirty Dozen+" Adversarial Payloads
1. **Shadow Field Injection on User Profile**: Creating `/users/u1` with `{ ...validFields, isAdmin: true, role: "super_admin" }` -> `PERMISSION_DENIED` (blocked by `keys().hasOnly(...)`).
2. **PII Read by Non-Owner**: Authenticated ordinary user `u2` attempting `get` or `list` on `/users/u1` -> `PERMISSION_DENIED`.
3. **Unverified Email Spoof (Owner Claim)**: User signing up with unverified email `fezinfezin42@gmail.com` (`email_verified: false`) attempting to create `/systemConfig/owner` -> `PERMISSION_DENIED`.
4. **Non-Owner Super Admin Claim**: Verified ordinary user `attacker@example.com` attempting to create `/systemConfig/owner` or `/admins/attacker` -> `PERMISSION_DENIED`.
5. **Non-Owner Account Moderation Attempt**: Ordinary user attempting to write `status: "suspended"` or `"blocked"` to `/accountModeration/{targetUid}` -> `PERMISSION_DENIED`.
6. **Owner Lockout Attempt**: Attempting to write `/accountModeration/{ownerUid}` -> `PERMISSION_DENIED`.
7. **Ordinary User Private Conversation Snooping**: Ordinary user `u3` attempting `get` or `list` on `/chats/c1` or `/chats/c1/messages` or `/groupChat/g1/messages` when `u3` is NOT in `participantIds` -> `PERMISSION_DENIED`.
8. **Suspended/Banned User Write Bypass**: User with `/accountModeration/{uid}.status in ["suspended", "blocked", "removed"]` attempting to send a message, create a chat/group, or start a call -> `PERMISSION_DENIED`.
9. **Audit Log Tampering**: Even the Owner attempting `update` or `delete` on `/systemLogs/log_1` -> `PERMISSION_DENIED`.
10. **Report Content Forgery on Review**: Updating `/reports/rep_1` trying to alter `messageTextSnippet`, `reportedByUid`, or `contextMessages` -> `PERMISSION_DENIED`.
11. **Ordinary User Website Settings Overwrite**: Regular user attempting to update `/websiteSettings/global` (`maintenanceMode: true` or `ownerMonitoringEnabled: false`) -> `PERMISSION_DENIED`.
12. **Stats Counter Manipulation**: User attempting to set `totalMessages: 999999` or decrement counters on `/systemStats/overview` -> `PERMISSION_DENIED`.
13. **Orphaned Message Write & Participant Tampering**: User creating a message under nonexistent `/chats/nonexistent/messages/m1` or `/groupChat/grp_1/messages/m1` with tampered `participantIds` -> `PERMISSION_DENIED`.
14. **Cross-User Privacy Consent Spoof**: User `u1` attempting to create or update `/userPrivacyConsents/u2` or set `consented: false` -> `PERMISSION_DENIED`.
15. **Owner API Unauthenticated / Non-Owner Access**: Calling `GET /api/owner/dashboard` or `POST /api/owner/conversations/chats/c1/access` without token or with a non-owner Firebase ID token -> `401 Unauthorized` / `403 Forbidden`.

