import {
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { BLUEPRINT_LIMITS, type PublicProfile } from '../types';
import { generateId } from '../utils/chatHelpers';
import { incrementSystemStat } from './moderation';

export const GROUP_CHAT_COLLECTION = 'groupChat';

export interface CreateGroupChatInput {
  title: string;
  description?: string;
  photoURL?: string;
  memberUids: string[];
  creator: PublicProfile;
}

/**
 * Creates a multi-participant group chat document in Firestore's `groupChat` collection
 * and posts an initial welcome message atomically in the same batch.
 */
export async function createGroupChat({
  title,
  description = '',
  photoURL = '',
  memberUids,
  creator,
}: CreateGroupChatInput): Promise<string> {
  const cleanTitle = title.trim().slice(0, BLUEPRINT_LIMITS.CHAT_TITLE_MAX);
  if (!cleanTitle) {
    throw new Error('Group name is required.');
  }

  const cleanDescription = description.trim().slice(0, BLUEPRINT_LIMITS.GROUP_DESCRIPTION_MAX);
  const cleanPhotoUrl = photoURL.trim().slice(0, BLUEPRINT_LIMITS.MEDIA_URL_MAX);

  const participantIds = Array.from(
    new Set([creator.uid, ...memberUids.filter((id) => BLUEPRINT_LIMITS.ID_PATTERN.test(id))])
  ).slice(0, BLUEPRINT_LIMITS.MAX_PARTICIPANTS);

  if (participantIds.length < 2) {
    throw new Error('Select at least one other participant to create a group chat.');
  }

  const groupId = generateId('grp');
  const msgId = generateId('msg');
  const snippet = `${creator.displayName} created group "${cleanTitle.slice(0, 40)}"`.slice(
    0,
    BLUEPRINT_LIMITS.LAST_MESSAGE_TEXT_MAX
  );

  const batch = writeBatch(db);
  const groupRef = doc(db, GROUP_CHAT_COLLECTION, groupId);
  const welcomeMsgRef = doc(db, GROUP_CHAT_COLLECTION, groupId, 'messages', msgId);

  batch.set(groupRef, {
    type: 'group',
    title: cleanTitle,
    description: cleanDescription,
    photoURL: cleanPhotoUrl,
    participantIds,
    adminIds: [creator.uid],
    createdBy: creator.uid,
    lastMessageText: snippet,
    lastMessageType: 'text',
    lastMessageSenderId: creator.uid,
    lastMessageAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(welcomeMsgRef, {
    chatId: groupId,
    senderId: creator.uid,
    senderName: (creator.displayName || 'User').slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
    participantIds,
    type: 'text',
    text: `${creator.displayName} created this group with ${participantIds.length} participants.`,
    mediaUrl: '',
    mediaMimeType: '',
    mediaName: '',
    mediaDurationSec: 0,
    readBy: [creator.uid],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    void incrementSystemStat('totalGroupChats');
    void incrementSystemStat('totalMessages');
    return groupId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `${GROUP_CHAT_COLLECTION}/${groupId}`);
    throw err;
  }
}

export async function addGroupChatParticipants(
  groupId: string,
  currentParticipantIds: string[],
  newMemberUids: string[]
): Promise<string[]> {
  const merged = Array.from(
    new Set([
      ...currentParticipantIds,
      ...newMemberUids.filter((id) => BLUEPRINT_LIMITS.ID_PATTERN.test(id)),
    ])
  ).slice(0, BLUEPRINT_LIMITS.MAX_PARTICIPANTS);

  if (merged.length === currentParticipantIds.length) {
    return merged;
  }

  try {
    await updateDoc(doc(db, GROUP_CHAT_COLLECTION, groupId), {
      participantIds: merged,
      updatedAt: serverTimestamp(),
    });
    return merged;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${GROUP_CHAT_COLLECTION}/${groupId}`);
    throw err;
  }
}

export async function removeGroupChatParticipant(
  groupId: string,
  currentParticipantIds: string[],
  currentAdminIds: string[],
  targetUid: string
): Promise<void> {
  const nextParticipants = currentParticipantIds.filter((uid) => uid !== targetUid);
  if (nextParticipants.length < 2) {
    throw new Error('A group chat must have at least 2 participants.');
  }

  const isTargetAdmin = currentAdminIds.includes(targetUid);
  const nextAdmins = currentAdminIds.filter((uid) => uid !== targetUid);

  try {
    if (isTargetAdmin) {
      if (nextAdmins.length === 0) {
        throw new Error('A group chat must keep at least one admin.');
      }
      await updateDoc(doc(db, GROUP_CHAT_COLLECTION, groupId), {
        participantIds: nextParticipants,
        adminIds: nextAdmins,
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, GROUP_CHAT_COLLECTION, groupId), {
        participantIds: nextParticipants,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${GROUP_CHAT_COLLECTION}/${groupId}`);
    throw err;
  }
}

export async function updateGroupChatDetails(
  groupId: string,
  updates: { title: string; description: string }
): Promise<void> {
  const cleanTitle = updates.title.trim().slice(0, BLUEPRINT_LIMITS.CHAT_TITLE_MAX);
  if (!cleanTitle) {
    throw new Error('Group name cannot be empty.');
  }
  const cleanDescription = updates.description
    .trim()
    .slice(0, BLUEPRINT_LIMITS.GROUP_DESCRIPTION_MAX);

  try {
    await updateDoc(doc(db, GROUP_CHAT_COLLECTION, groupId), {
      title: cleanTitle,
      description: cleanDescription,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${GROUP_CHAT_COLLECTION}/${groupId}`);
    throw err;
  }
}
