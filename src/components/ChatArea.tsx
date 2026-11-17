import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Edit3,
  Flag,
  Image as ImageIcon,
  Info,
  Loader2,
  LogOut,
  Mic,
  Palette,
  Paperclip,
  Phone,
  PhoneCall,
  Send,
  Smile,
  Trash2,
  UserMinus,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useCall } from '../contexts/CallContext';
import {
  BLUEPRINT_LIMITS,
  type ChatCollection,
  type ChatMessage,
  type ChatThread,
  type PublicProfile,
  type ReportType,
} from '../types';
import {
  formatDateDivider,
  formatLastSeen,
  formatShortTime,
  generateId,
} from '../utils/chatHelpers';
import { uploadChatMedia } from '../services/media';
import { incrementSystemStat } from '../services/moderation';
import {
  addGroupChatParticipants,
  GROUP_CHAT_COLLECTION,
  removeGroupChatParticipant,
  updateGroupChatDetails,
} from '../services/groupChats';
import { Avatar } from './Avatar';
import { VoiceNotePlayer } from './VoiceNotePlayer';
import { VoiceRecorderBar } from './VoiceRecorderBar';
import { MediaLightbox } from './MediaLightbox';
import { WallpaperModal } from './WallpaperModal';
import { ReportModal } from './ReportModal';
import {
  buildPatternSvgDataUri,
  loadWallpaperSetting,
  WALLPAPER_PRESETS,
  type WallpaperSetting,
} from '../utils/wallpapers';

interface ChatAreaProps {
  chat: ChatThread;
  profilesMap: Record<string, PublicProfile>;
  directoryUsers: PublicProfile[];
  darkMode: boolean;
  onBackMobile: () => void;
}

const QUICK_EMOJIS = [
  '😀', '😂', '😍', '🥳', '😎', '🙏', '👍', '👏',
  '🔥', '🎉', '❤️', '💯', '😮', '😢', '🤔', '👋',
  '🎧', '📷', '🎥', '✅', '🚀', '☕', '🌟', '💬',
];

export function ChatArea({
  chat,
  profilesMap,
  directoryUsers,
  darkMode,
  onBackMobile,
}: ChatAreaProps) {
  const { publicProfile, websiteSettings } = useAuth();
  const { startCall, activeCall } = useCall();

  const chatCollection = chat.sourceCollection || 'chats';
  const isGroupChatCollection = chatCollection === GROUP_CHAT_COLLECTION;
  const isGroupAdmin =
    chat.type === 'group' &&
    Boolean(publicProfile?.uid) &&
    (isGroupChatCollection
      ? (chat.adminIds || []).includes(publicProfile!.uid)
      : chat.createdBy === publicProfile!.uid);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [draftText, setDraftText] = useState('');
  const [sending, setSending] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [editingGroupMeta, setEditingGroupMeta] = useState(false);
  const [groupTitleDraft, setGroupTitleDraft] = useState(chat.title || '');
  const [groupDescDraft, setGroupDescDraft] = useState(chat.description || '');
  const [groupActionBusy, setGroupActionBusy] = useState(false);
  const [groupActionError, setGroupActionError] = useState<string | null>(null);
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);
  const [wallpaper, setWallpaper] = useState<WallpaperSetting>(() =>
    loadWallpaperSetting(publicProfile?.uid || 'guest', chat.id)
  );

  // Attachment preview state
  const [pendingFile, setPendingFile] = useState<{
    file: File;
    previewUrl: string;
    kind: 'image' | 'video';
    caption: string;
  } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Editing message state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Media Lightbox state
  const [lightboxMedia, setLightboxMedia] = useState<{
    url: string;
    type: 'image' | 'video';
    name: string;
  } | null>(null);

  const [reportTarget, setReportTarget] = useState<{
    reportType: ReportType;
    reportedUid: string;
    reportedName: string;
    messageId?: string;
    messageTextSnippet?: string;
    surroundingMessages?: string[];
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setGroupTitleDraft(chat.title || '');
    setGroupDescDraft(chat.description || '');
    setEditingGroupMeta(false);
    setShowAddMembers(false);
    setGroupActionError(null);
  }, [chat.id, chat.title, chat.description]);

  const peerProfile = useMemo(() => {
    if (chat.type !== 'direct' || !publicProfile) return null;
    const peerUid = chat.participantIds.find((id) => id !== publicProfile.uid);
    return peerUid ? profilesMap[peerUid] || null : null;
  }, [chat, profilesMap, publicProfile]);

  const chatDisplayName =
    chat.type === 'group'
      ? chat.title || 'Group Chat'
      : peerProfile?.displayName || 'VerdeChat User';

  const groupParticipantSummary = useMemo(() => {
    if (chat.type !== 'group') return '';
    const names = chat.participantIds
      .map((uid) => (uid === publicProfile?.uid ? 'You' : profilesMap[uid]?.displayName))
      .filter((name): name is string => Boolean(name));
    if (names.length === 0) return `${chat.participantIds.length} participants`;
    return `${chat.participantIds.length} participants · ${names.slice(0, 4).join(', ')}${
      names.length > 4 ? ` +${names.length - 4}` : ''
    }`;
  }, [chat.type, chat.participantIds, profilesMap, publicProfile?.uid]);

  const chatSubtitle =
    chat.type === 'group'
      ? groupParticipantSummary
      : formatLastSeen(peerProfile?.lastSeen, peerProfile?.isOnline);

  // Real-time messages listener
  useEffect(() => {
    if (!publicProfile) return;
    setLoadingMessages(true);

    const path = `${chatCollection}/${chat.id}/messages`;
    const q = query(
      collection(db, chatCollection, chat.id, 'messages'),
      where('participantIds', 'array-contains', publicProfile.uid)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ChatMessage[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ChatMessage, 'id'>),
        }));
        list.sort((a, b) => {
          const tA = a.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
          const tB = b.createdAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER;
          return tA - tB;
        });
        setMessages(list);
        setLoadingMessages(false);

        // Mark unread messages from others as read
        const unread = list.filter(
          (m) => m.senderId !== publicProfile.uid && !m.readBy.includes(publicProfile.uid)
        );
        if (unread.length > 0) {
          const batch = writeBatch(db);
          unread.slice(0, 25).forEach((m) => {
            const nextReadBy = Array.from(new Set([...m.readBy, publicProfile.uid])).slice(
              0,
              BLUEPRINT_LIMITS.MAX_PARTICIPANTS
            );
            batch.update(doc(db, chatCollection, chat.id, 'messages', m.id), {
              readBy: nextReadBy,
              updatedAt: serverTimestamp(),
            });
          });
          void batch.commit().catch(() => {});
        }
      },
      (err) => {
        setLoadingMessages(false);
        handleFirestoreError(err, OperationType.LIST, path);
      }
    );

    return () => unsub();
  }, [chat.id, chatCollection, publicProfile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, chat.id]);

  useEffect(() => {
    const uid = publicProfile?.uid || 'guest';
    const sync = () => setWallpaper(loadWallpaperSetting(uid, chat.id));
    sync();
    window.addEventListener('verdechat-wallpaper-changed', sync);
    return () => window.removeEventListener('verdechat-wallpaper-changed', sync);
  }, [publicProfile?.uid, chat.id]);

  useEffect(() => {
    return () => {
      if (pendingFile?.previewUrl) {
        URL.revokeObjectURL(pendingFile.previewUrl);
      }
    };
  }, [pendingFile]);

  const sendMessageRecord = async (payload: {
    type: 'text' | 'image' | 'video' | 'audio';
    text: string;
    mediaUrl: string;
    mediaMimeType: string;
    mediaName: string;
    mediaDurationSec: number;
    snippet: string;
  }) => {
    if (!publicProfile) return;
    const msgId = generateId('msg');
    const cleanText = payload.text.slice(0, BLUEPRINT_LIMITS.MESSAGE_TEXT_MAX);
    const cleanSnippet = payload.snippet.slice(0, BLUEPRINT_LIMITS.LAST_MESSAGE_TEXT_MAX);

    const batch = writeBatch(db);
    batch.set(doc(db, chatCollection, chat.id, 'messages', msgId), {
      chatId: chat.id,
      senderId: publicProfile.uid,
      senderName: (publicProfile.displayName || 'User').slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX),
      participantIds: chat.participantIds,
      type: payload.type,
      text: cleanText,
      mediaUrl: payload.mediaUrl.slice(0, BLUEPRINT_LIMITS.MEDIA_URL_MAX),
      mediaMimeType: payload.mediaMimeType.slice(0, 100),
      mediaName: payload.mediaName.slice(0, BLUEPRINT_LIMITS.MEDIA_NAME_MAX),
      mediaDurationSec: Math.max(0, Math.min(3600, payload.mediaDurationSec)),
      readBy: [publicProfile.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, chatCollection, chat.id), {
      lastMessageText: cleanSnippet,
      lastMessageType: payload.type,
      lastMessageSenderId: publicProfile.uid,
      lastMessageAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
      void incrementSystemStat('totalMessages');
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `${chatCollection}/${chat.id}/messages/${msgId}`
      );
    }
  };

  const handleSendText = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = draftText.trim();
    if (!trimmed || sending) return;
    setComposerError(null);
    setSending(true);
    setDraftText('');
    setShowEmojiPicker(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    try {
      await sendMessageRecord({
        type: 'text',
        text: trimmed,
        mediaUrl: '',
        mediaMimeType: '',
        mediaName: '',
        mediaDurationSec: 0,
        snippet: trimmed,
      });
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : 'Failed to send message');
      setDraftText(trimmed);
    } finally {
      setSending(false);
    }
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!websiteSettings.allowMediaUploads) {
      setComposerError('Media uploads are currently paused by the site administrator.');
      return;
    }

    if (file.size > 45 * 1024 * 1024) {
      setComposerError('Please choose a photo or video smaller than 45 MB.');
      return;
    }

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      setComposerError('Only image and video files are supported here.');
      return;
    }

    setComposerError(null);
    setPendingFile({
      file,
      previewUrl: URL.createObjectURL(file),
      kind: isVideo ? 'video' : 'image',
      caption: '',
    });
  };

  const handleConfirmMediaSend = async () => {
    if (!pendingFile || sending) return;
    setSending(true);
    setUploadProgress(0);
    setComposerError(null);
    try {
      const res = await uploadChatMedia(
        pendingFile.file,
        `chats/${chat.id}`,
        pendingFile.file.name,
        (pct) => setUploadProgress(pct)
      );
      const caption = pendingFile.caption.trim();
      const snippet =
        caption || (pendingFile.kind === 'video' ? 'Video' : 'Photo');

      await sendMessageRecord({
        type: pendingFile.kind,
        text: caption,
        mediaUrl: res.url,
        mediaMimeType: res.mimeType,
        mediaName: res.fileName,
        mediaDurationSec: 0,
        snippet,
      });

      URL.revokeObjectURL(pendingFile.previewUrl);
      setPendingFile(null);
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : 'Failed to upload media');
    } finally {
      setSending(false);
      setUploadProgress(null);
    }
  };

  const handleSendVoice = async (blob: Blob, durationSec: number, mimeType: string) => {
    setComposerError(null);
    try {
      const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const res = await uploadChatMedia(
        blob,
        `chats/${chat.id}`,
        `voice_${Date.now()}.${ext}`
      );
      await sendMessageRecord({
        type: 'audio',
        text: '',
        mediaUrl: res.url,
        mediaMimeType: res.mimeType,
        mediaName: res.fileName,
        mediaDurationSec: durationSec,
        snippet: 'Voice message',
      });
      setIsRecordingVoice(false);
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : 'Could not upload voice recording');
      setIsRecordingVoice(false);
    }
  };

  const handleSaveEdit = async (msg: ChatMessage) => {
    const clean = editingText.trim().slice(0, BLUEPRINT_LIMITS.MESSAGE_TEXT_MAX);
    if (!clean) return;
    try {
      await updateDoc(doc(db, chatCollection, chat.id, 'messages', msg.id), {
        text: clean,
        updatedAt: serverTimestamp(),
      });
      setEditingMessageId(null);
      setEditingText('');
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `${chatCollection}/${chat.id}/messages/${msg.id}`
      );
    }
  };

  const handleDeleteMessage = async (msg: ChatMessage) => {
    try {
      await deleteDoc(doc(db, chatCollection, chat.id, 'messages', msg.id));
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `${chatCollection}/${chat.id}/messages/${msg.id}`
      );
    }
  };

  const addableDirectoryUsers = useMemo(() => {
    if (chat.type !== 'group') return [];
    return directoryUsers.filter((u) => !chat.participantIds.includes(u.uid));
  }, [chat.type, chat.participantIds, directoryUsers]);

  const handleAddGroupParticipant = async (newUid: string) => {
    if (groupActionBusy) return;
    setGroupActionBusy(true);
    setGroupActionError(null);
    try {
      if (isGroupChatCollection) {
        await addGroupChatParticipants(chat.id, chat.participantIds, [newUid]);
      } else {
        const merged = Array.from(new Set([...chat.participantIds, newUid])).slice(
          0,
          BLUEPRINT_LIMITS.MAX_PARTICIPANTS
        );
        await updateDoc(doc(db, 'chats', chat.id), {
          participantIds: merged,
          updatedAt: serverTimestamp(),
        });
      }
      setShowAddMembers(false);
    } catch (err) {
      setGroupActionError(err instanceof Error ? err.message : 'Could not add participant.');
    } finally {
      setGroupActionBusy(false);
    }
  };

  const handleRemoveOrLeaveParticipant = async (targetUid: string) => {
    if (groupActionBusy) return;
    setGroupActionBusy(true);
    setGroupActionError(null);
    try {
      if (isGroupChatCollection) {
        await removeGroupChatParticipant(
          chat.id,
          chat.participantIds,
          chat.adminIds || [chat.createdBy],
          targetUid
        );
      } else {
        const next = chat.participantIds.filter((id) => id !== targetUid);
        if (next.length < 2) {
          throw new Error('A group chat must keep at least 2 participants.');
        }
        await updateDoc(doc(db, 'chats', chat.id), {
          participantIds: next,
          updatedAt: serverTimestamp(),
        });
      }
      if (targetUid === publicProfile?.uid) {
        onBackMobile();
      }
    } catch (err) {
      setGroupActionError(err instanceof Error ? err.message : 'Could not update participants.');
    } finally {
      setGroupActionBusy(false);
    }
  };

  const handleSaveGroupMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (groupActionBusy) return;
    setGroupActionBusy(true);
    setGroupActionError(null);
    try {
      if (isGroupChatCollection) {
        await updateGroupChatDetails(chat.id, {
          title: groupTitleDraft,
          description: groupDescDraft,
        });
      } else {
        await updateDoc(doc(db, 'chats', chat.id), {
          title: groupTitleDraft.trim().slice(0, BLUEPRINT_LIMITS.CHAT_TITLE_MAX),
          updatedAt: serverTimestamp(),
        });
      }
      setEditingGroupMeta(false);
    } catch (err) {
      setGroupActionError(err instanceof Error ? err.message : 'Could not update group info.');
    } finally {
      setGroupActionBusy(false);
    }
  };

  const sharedMediaMessages = useMemo(
    () => messages.filter((m) => (m.type === 'image' || m.type === 'video') && m.mediaUrl),
    [messages]
  );

  const wallpaperStyle = useMemo<React.CSSProperties>(() => {
    if (wallpaper.presetId === 'custom' && wallpaper.customUrl) {
      const dim = wallpaper.dimOpacity ?? 0.25;
      const overlayColor = darkMode
        ? `rgba(11, 20, 26, ${Math.max(0.15, dim)})`
        : `rgba(255, 255, 255, ${dim})`;
      return {
        backgroundImage: `linear-gradient(${overlayColor}, ${overlayColor}), url("${wallpaper.customUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    const preset =
      WALLPAPER_PRESETS.find((p) => p.id === wallpaper.presetId) || WALLPAPER_PRESETS[0];
    const bg = darkMode ? preset.darkBg : preset.lightBg;
    const stroke = darkMode ? preset.darkStroke : preset.lightStroke;
    return {
      backgroundColor: bg,
      backgroundImage: preset.hasPattern ? buildPatternSvgDataUri(stroke) : 'none',
    };
  }, [wallpaper, darkMode]);

  let lastDividerLabel = '';

  return (
    <div className="flex-1 flex h-full min-w-0 relative">
      {/* Main Chat Column */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Chat Header */}
        <header className="h-[62px] shrink-0 px-3 sm:px-4 bg-[#F0F2F5] dark:bg-[#202C33] border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onBackMobile}
              aria-label="Back to chats"
              className="md:hidden min-w-[40px] min-h-[40px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#54656F] dark:text-[#AEBAC1] cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <Avatar
              src={chat.type === 'group' ? chat.photoURL : peerProfile?.photoURL}
              name={chatDisplayName}
              isOnline={peerProfile?.isOnline}
              isGroup={chat.type === 'group'}
            />

            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate leading-tight">
                {chatDisplayName}
              </h2>
              <p className="text-xs text-[#667781] dark:text-[#8696A0] truncate">
                {chatSubtitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {chat.type === 'direct' && peerProfile && (
              <>
                <button
                  type="button"
                  disabled={Boolean(activeCall) || !websiteSettings.allowVoiceVideoCalls}
                  onClick={() => startCall(peerProfile, chat.id, 'audio')}
                  aria-label="Start voice call"
                  title={
                    websiteSettings.allowVoiceVideoCalls
                      ? 'Voice call'
                      : 'Voice calls are currently paused by site admin'
                  }
                  className="min-w-[42px] min-h-[42px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#54656F] dark:text-[#AEBAC1] disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <Phone className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  disabled={Boolean(activeCall) || !websiteSettings.allowVoiceVideoCalls}
                  onClick={() => startCall(peerProfile, chat.id, 'video')}
                  aria-label="Start video call"
                  title={
                    websiteSettings.allowVoiceVideoCalls
                      ? 'Video call'
                      : 'Video calls are currently paused by site admin'
                  }
                  className="min-w-[42px] min-h-[42px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#54656F] dark:text-[#AEBAC1] disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <Video className="w-5 h-5" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setShowWallpaperModal(true)}
              aria-label="Change chat wallpaper"
              title="Change wallpaper"
              className="min-w-[42px] min-h-[42px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#54656F] dark:text-[#AEBAC1] transition-colors cursor-pointer"
            >
              <Palette className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setShowInfoDrawer((v) => !v)}
              aria-label="Chat details"
              title="Chat info & shared media"
              className={`min-w-[42px] min-h-[42px] rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                showInfoDrawer
                  ? 'bg-[#00A884]/15 text-[#008069] dark:text-[#00A884]'
                  : 'hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#AEBAC1]'
              }`}
            >
              <Info className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Messages Feed */}
        <div
          style={wallpaperStyle}
          className="flex-1 overflow-y-auto px-3 sm:px-6 lg:px-10 py-4 space-y-2 transition-colors"
        >
          {loadingMessages ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-[#008069] dark:text-[#00A884]" />
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-xs text-center bg-white/90 dark:bg-[#111B21]/90 border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl px-5 py-4 shadow-xs">
                <p className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF]">
                  Say hello to {chatDisplayName}
                </p>
                <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1">
                  Send a text, share photos or videos, record a voice note, or place a browser voice call.
                </p>
                {chat.type === 'direct' && peerProfile && (
                  <div className="mt-3 flex items-center justify-center gap-2">
                    <button
                      type="button"
                      disabled={Boolean(activeCall) || !websiteSettings.allowVoiceVideoCalls}
                      onClick={() => startCall(peerProfile, chat.id, 'audio')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Voice Call</span>
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(activeCall) || !websiteSettings.allowVoiceVideoCalls}
                      onClick={() => startCall(peerProfile, chat.id, 'video')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] hover:bg-[#E9EDEF] dark:hover:bg-[#2A3942] disabled:opacity-50 text-[#111B21] dark:text-[#E9EDEF] text-xs font-semibold cursor-pointer"
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>Video</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => {
              const divider = formatDateDivider(msg.createdAt);
              const showDivider = divider !== lastDividerLabel;
              lastDividerLabel = divider;

              const isOwn = msg.senderId === publicProfile?.uid;
              const isReadByPeer = msg.readBy.some((uid) => uid !== msg.senderId);
              const surrounding = !isOwn
                ? messages
                    .slice(Math.max(0, idx - 2), idx + 3)
                    .map((m) => `${m.senderName || 'User'}: ${m.text || `[${m.type}]`}`)
                : [];

              return (
                <div key={msg.id}>
                  {showDivider && (
                    <div className="flex justify-center my-3">
                      <span className="px-3 py-1 rounded-lg bg-white/90 dark:bg-[#182229] text-[11px] font-medium text-[#54656F] dark:text-[#8696A0] shadow-xs">
                        {divider}
                      </span>
                    </div>
                  )}

                  {msg.type === 'call' ? (
                    <div className="flex justify-center my-2">
                      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/90 dark:bg-[#182229] border border-[#E9EDEF] dark:border-[#222E35] text-xs text-[#54656F] dark:text-[#AEBAC1] shadow-xs">
                        <PhoneCall className="w-3.5 h-3.5 text-[#008069] dark:text-[#00A884]" />
                        <span>{msg.text}</span>
                        <span className="text-[11px] font-mono tabular-nums opacity-75">
                          {formatShortTime(msg.createdAt)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group`}>
                      <div
                        className={`relative max-w-[84%] sm:max-w-[68%] rounded-2xl px-3.5 py-2 shadow-xs ${
                          isOwn
                            ? 'bg-[#D9FDD3] dark:bg-[#005C4B] text-[#111B21] dark:text-[#E9EDEF] rounded-tr-xs'
                            : 'bg-white dark:bg-[#202C33] text-[#111B21] dark:text-[#E9EDEF] rounded-tl-xs'
                        }`}
                      >
                        {chat.type === 'group' && !isOwn && (
                          <div className="text-[11px] font-semibold text-[#008069] dark:text-[#00A884] mb-0.5">
                            {msg.senderName}
                          </div>
                        )}

                        {msg.type === 'image' && msg.mediaUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setLightboxMedia({
                                url: msg.mediaUrl,
                                type: 'image',
                                name: msg.mediaName,
                              })
                            }
                            className="block mb-1.5 rounded-xl overflow-hidden bg-black/5 cursor-pointer"
                          >
                            <img
                              src={msg.mediaUrl}
                              alt={msg.mediaName || 'Shared photo'}
                              referrerPolicy="no-referrer"
                              className="max-h-72 w-auto max-w-full object-cover rounded-xl"
                            />
                          </button>
                        )}

                        {msg.type === 'video' && msg.mediaUrl && (
                          <div className="mb-1.5 rounded-xl overflow-hidden bg-black">
                            <video
                              src={msg.mediaUrl}
                              controls
                              playsInline
                              preload="metadata"
                              className="max-h-72 w-full rounded-xl"
                            />
                          </div>
                        )}

                        {msg.type === 'audio' && msg.mediaUrl && (
                          <VoiceNotePlayer
                            src={msg.mediaUrl}
                            durationSec={msg.mediaDurationSec}
                            isOwn={isOwn}
                          />
                        )}

                        {editingMessageId === msg.id ? (
                          <div className="space-y-2 min-w-[200px]">
                            <input
                              type="text"
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-white/80 dark:bg-[#111B21] text-sm outline-none"
                            />
                            <div className="flex justify-end gap-2 text-xs">
                              <button
                                type="button"
                                onClick={() => setEditingMessageId(null)}
                                className="px-2 py-1 rounded text-[#667781] cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(msg)}
                                className="px-2.5 py-1 rounded bg-[#008069] text-white font-medium cursor-pointer"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          msg.text && (
                            <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
                              {msg.text}
                            </p>
                          )
                        )}

                        <div className="flex items-center justify-end gap-1.5 mt-1">
                          {isOwn && msg.type === 'text' && editingMessageId !== msg.id && (
                            <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex items-center gap-1 mr-1 transition-opacity">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMessageId(msg.id);
                                  setEditingText(msg.text);
                                }}
                                aria-label="Edit message"
                                className="p-0.5 text-[#667781] dark:text-[#AEBAC1] hover:text-[#111B21] dark:hover:text-white cursor-pointer"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteMessage(msg)}
                                aria-label="Delete message"
                                className="p-0.5 text-[#667781] dark:text-[#AEBAC1] hover:text-red-500 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}

                          {!isOwn && (
                            <button
                              type="button"
                              onClick={() =>
                                setReportTarget({
                                  reportType: 'message',
                                  reportedUid: msg.senderId,
                                  reportedName: msg.senderName || 'User',
                                  messageId: msg.id,
                                  messageTextSnippet: msg.text || `[${msg.type} attachment]`,
                                  surroundingMessages: surrounding,
                                })
                              }
                              aria-label="Report message"
                              title="Report message"
                              className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 p-0.5 mr-1 text-[#667781] dark:text-[#AEBAC1] hover:text-amber-600 dark:hover:text-amber-400 transition-opacity cursor-pointer"
                            >
                              <Flag className="w-3 h-3" />
                            </button>
                          )}

                          <span className="text-[11px] font-mono tabular-nums text-[#667781] dark:text-[#AEBAC1]">
                            {formatShortTime(msg.createdAt)}
                          </span>
                          {isOwn && (
                            <span aria-label={isReadByPeer ? 'Read' : 'Sent'}>
                              {isReadByPeer ? (
                                <CheckCheck className="w-3.5 h-3.5 text-[#53BDEB]" />
                              ) : (
                                <Check className="w-3.5 h-3.5 text-[#667781] dark:text-[#AEBAC1]" />
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer Error */}
        {composerError && (
          <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20 flex items-center justify-between text-xs text-red-700 dark:text-red-300">
            <span>{composerError}</span>
            <button type="button" onClick={() => setComposerError(null)} className="cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Emoji Picker Popover */}
        {showEmojiPicker && !isRecordingVoice && (
          <div className="px-4 py-2.5 bg-[#F0F2F5] dark:bg-[#202C33] border-t border-[#E9EDEF] dark:border-[#222E35]">
            <div className="flex flex-wrap gap-1.5">
              {QUICK_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setDraftText((prev) => prev + emoji)}
                  className="w-9 h-9 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-xl flex items-center justify-center cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Composer Bar */}
        <footer className="shrink-0 px-3 sm:px-4 py-2.5 bg-[#F0F2F5] dark:bg-[#202C33] border-t border-[#E9EDEF] dark:border-[#222E35]">
          {isRecordingVoice ? (
            <VoiceRecorderBar
              onSendVoice={handleSendVoice}
              onCancel={() => setIsRecordingVoice(false)}
            />
          ) : (
            <form onSubmit={handleSendText} className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                onChange={handleFileSelected}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => setShowEmojiPicker((v) => !v)}
                aria-label="Toggle emoji picker"
                className="min-w-[44px] min-h-[44px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#54656F] dark:text-[#AEBAC1] shrink-0 cursor-pointer"
              >
                <Smile className="w-5 h-5" />
              </button>

              <button
                type="button"
                disabled={!websiteSettings.allowMediaUploads}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach photo or video"
                title={
                  websiteSettings.allowMediaUploads
                    ? 'Share photo or video'
                    : 'Media uploads are currently paused by site admin'
                }
                className="min-w-[44px] min-h-[44px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-[#54656F] dark:text-[#AEBAC1] shrink-0 cursor-pointer"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              <div className="flex-1 bg-white dark:bg-[#2A3942] rounded-2xl px-4 py-2.5 flex items-center">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  maxLength={BLUEPRINT_LIMITS.MESSAGE_TEXT_MAX}
                  value={draftText}
                  onChange={(e) => {
                    setDraftText(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSendText();
                    }
                  }}
                  placeholder="Type a message"
                  className="w-full bg-transparent text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder:text-[#667781] dark:placeholder:text-[#8696A0] outline-none resize-none max-h-[120px] leading-relaxed"
                />
              </div>

              {draftText.trim() ? (
                <button
                  type="submit"
                  disabled={sending}
                  aria-label="Send message"
                  className="min-w-[44px] min-h-[44px] rounded-full bg-[#00A884] hover:bg-[#008F70] text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:opacity-60"
                >
                  {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!websiteSettings.allowMediaUploads}
                  onClick={() => setIsRecordingVoice(true)}
                  aria-label="Record voice message"
                  title={
                    websiteSettings.allowMediaUploads
                      ? 'Record voice note'
                      : 'Voice & media uploads are currently paused by site admin'
                  }
                  className="min-w-[44px] min-h-[44px] rounded-full bg-[#00A884] hover:bg-[#008F70] disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                >
                  <Mic className="w-5 h-5" />
                </button>
              )}
            </form>
          )}
        </footer>
      </div>

      {/* Chat Info & Shared Media Drawer */}
      {showInfoDrawer && (
        <aside className="absolute inset-0 z-30 lg:static lg:w-80 bg-white dark:bg-[#111B21] border-l border-[#E9EDEF] dark:border-[#222E35] flex flex-col">
          <div className="h-[62px] px-4 bg-[#F0F2F5] dark:bg-[#202C33] border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between">
            <span className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              Chat Info
            </span>
            <button
              type="button"
              onClick={() => setShowInfoDrawer(false)}
              aria-label="Close chat info"
              className="min-w-[36px] min-h-[36px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#54656F] dark:text-[#AEBAC1] cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <div className="flex flex-col items-center text-center">
              <Avatar
                src={chat.type === 'group' ? chat.photoURL : peerProfile?.photoURL}
                name={chatDisplayName}
                size="xl"
                isOnline={peerProfile?.isOnline}
                isGroup={chat.type === 'group'}
              />
              <h3 className="text-lg font-bold text-[#111B21] dark:text-[#E9EDEF] mt-3">
                {chatDisplayName}
              </h3>
              {chat.type === 'group' && chat.description && !editingGroupMeta && (
                <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1.5">
                  {chat.description}
                </p>
              )}

              {chat.type === 'group' && isGroupAdmin && !editingGroupMeta && (
                <button
                  type="button"
                  onClick={() => setEditingGroupMeta(true)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#008069] dark:text-[#00A884] hover:underline cursor-pointer"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>Edit group info</span>
                </button>
              )}

              {chat.type === 'group' && editingGroupMeta && (
                <form onSubmit={handleSaveGroupMeta} className="mt-3 w-full space-y-2 text-left">
                  <input
                    type="text"
                    required
                    maxLength={BLUEPRINT_LIMITS.CHAT_TITLE_MAX}
                    value={groupTitleDraft}
                    onChange={(e) => setGroupTitleDraft(e.target.value)}
                    placeholder="Group name"
                    className="w-full px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs text-[#111B21] dark:text-[#E9EDEF] outline-none"
                  />
                  {isGroupChatCollection && (
                    <input
                      type="text"
                      maxLength={BLUEPRINT_LIMITS.GROUP_DESCRIPTION_MAX}
                      value={groupDescDraft}
                      onChange={(e) => setGroupDescDraft(e.target.value)}
                      placeholder="Group description"
                      className="w-full px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs text-[#111B21] dark:text-[#E9EDEF] outline-none"
                    />
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingGroupMeta(false)}
                      className="px-2.5 py-1 text-xs text-[#667781] cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={groupActionBusy}
                      className="px-3 py-1 rounded-lg bg-[#008069] text-white text-xs font-semibold cursor-pointer"
                    >
                      Save
                    </button>
                  </div>
                </form>
              )}

              {peerProfile && (
                <>
                  <p className="text-xs text-[#008069] dark:text-[#00A884]">
                    @{peerProfile.username}
                  </p>
                  <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-2">
                    {peerProfile.about}
                  </p>
                  <div className="mt-4 w-full grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={Boolean(activeCall) || !websiteSettings.allowVoiceVideoCalls}
                      onClick={() => startCall(peerProfile, chat.id, 'audio')}
                      className="py-2.5 px-3 rounded-xl bg-[#00A884]/12 hover:bg-[#00A884]/20 disabled:opacity-50 text-[#008069] dark:text-[#00A884] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Phone className="w-4 h-4" />
                      <span>Voice Call</span>
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(activeCall) || !websiteSettings.allowVoiceVideoCalls}
                      onClick={() => startCall(peerProfile, chat.id, 'video')}
                      className="py-2.5 px-3 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] hover:bg-[#E9EDEF] dark:hover:bg-[#2A3942] disabled:opacity-50 text-[#111B21] dark:text-[#E9EDEF] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Video className="w-4 h-4" />
                      <span>Video Call</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setReportTarget({
                        reportType: 'user',
                        reportedUid: peerProfile.uid,
                        reportedName: peerProfile.displayName,
                      })
                    }
                    className="mt-2.5 w-full py-2 px-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    <span>Report {peerProfile.displayName}</span>
                  </button>
                </>
              )}
            </div>

            {chat.type === 'group' && (
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h4 className="text-xs font-semibold text-[#667781] dark:text-[#8696A0]">
                    Participants ({chat.participantIds.length}/{BLUEPRINT_LIMITS.MAX_PARTICIPANTS})
                  </h4>
                  {isGroupAdmin && chat.participantIds.length < BLUEPRINT_LIMITS.MAX_PARTICIPANTS && (
                    <button
                      type="button"
                      onClick={() => setShowAddMembers((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#008069] dark:text-[#00A884] cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>{showAddMembers ? 'Done' : 'Add'}</span>
                    </button>
                  )}
                </div>

                {groupActionError && (
                  <p className="text-xs text-red-600 dark:text-red-400 mb-2">{groupActionError}</p>
                )}

                {showAddMembers && isGroupAdmin && (
                  <div className="mb-3 p-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] space-y-1.5 max-h-40 overflow-y-auto">
                    {addableDirectoryUsers.length === 0 ? (
                      <p className="text-xs text-[#667781] dark:text-[#8696A0] text-center py-2">
                        All discoverable contacts are already in this group.
                      </p>
                    ) : (
                      addableDirectoryUsers.map((candidate) => (
                        <button
                          key={candidate.uid}
                          type="button"
                          disabled={groupActionBusy}
                          onClick={() => handleAddGroupParticipant(candidate.uid)}
                          className="w-full flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-white dark:hover:bg-[#111B21] text-left cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Avatar src={candidate.photoURL} name={candidate.displayName} size="sm" />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                                {candidate.displayName}
                              </div>
                              <div className="text-[11px] text-[#667781] dark:text-[#8696A0] truncate">
                                @{candidate.username}
                              </div>
                            </div>
                          </div>
                          <UserPlus className="w-3.5 h-3.5 text-[#008069] dark:text-[#00A884] shrink-0" />
                        </button>
                      ))
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {chat.participantIds.map((uid) => {
                    const p = profilesMap[uid];
                    const isUidAdmin = isGroupChatCollection
                      ? (chat.adminIds || []).includes(uid)
                      : chat.createdBy === uid;
                    const isSelf = uid === publicProfile?.uid;

                    return (
                      <div key={uid} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar
                            src={p?.photoURL}
                            name={p?.displayName || 'User'}
                            size="sm"
                            isOnline={p?.isOnline}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                              {isSelf ? `${p?.displayName || 'You'} (You)` : p?.displayName || uid}
                            </div>
                            <div className="text-[11px] text-[#667781] dark:text-[#8696A0] truncate">
                              {p?.username ? `@${p.username}` : 'Member'}
                              {isUidAdmin ? ' · Admin' : ''}
                            </div>
                          </div>
                        </div>

                        {isGroupAdmin && !isSelf && chat.participantIds.length > 2 && (
                          <button
                            type="button"
                            disabled={groupActionBusy}
                            onClick={() => handleRemoveOrLeaveParticipant(uid)}
                            aria-label={`Remove ${p?.displayName || uid}`}
                            title="Remove participant"
                            className="p-1.5 rounded-lg text-[#667781] hover:text-red-500 hover:bg-red-500/10 cursor-pointer"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {isGroupChatCollection &&
                  !isGroupAdmin &&
                  chat.participantIds.length > 2 &&
                  publicProfile?.uid && (
                    <button
                      type="button"
                      disabled={groupActionBusy}
                      onClick={() => handleRemoveOrLeaveParticipant(publicProfile.uid)}
                      className="mt-3 w-full py-2 px-3 rounded-xl text-xs font-semibold text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/15 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Leave Group</span>
                    </button>
                  )}
              </div>
            )}

            <div>
              <h4 className="text-xs font-semibold text-[#667781] dark:text-[#8696A0] mb-2">
                Shared Photos & Videos ({sharedMediaMessages.length})
              </h4>
              {sharedMediaMessages.length === 0 ? (
                <div className="p-4 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-center text-xs text-[#667781] dark:text-[#8696A0]">
                  <ImageIcon className="w-5 h-5 mx-auto mb-1 opacity-60" />
                  No photos or videos shared yet
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {sharedMediaMessages.slice(-9).reverse().map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setLightboxMedia({
                          url: m.mediaUrl,
                          type: m.type === 'video' ? 'video' : 'image',
                          name: m.mediaName,
                        })
                      }
                      className="aspect-square rounded-lg overflow-hidden bg-black/10 cursor-pointer"
                    >
                      {m.type === 'video' ? (
                        <video src={m.mediaUrl} className="w-full h-full object-cover" />
                      ) : (
                        <img
                          src={m.mediaUrl}
                          alt={m.mediaName}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* Pre-send Media Preview Modal */}
      {pendingFile && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Send media preview"
        >
          <div className="w-full max-w-lg bg-white dark:bg-[#111B21] rounded-2xl overflow-hidden border border-[#E9EDEF] dark:border-[#222E35] shadow-2xl flex flex-col">
            <div className="px-5 py-3.5 border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between">
              <span className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                Send {pendingFile.kind === 'video' ? 'Video' : 'Photo'}
              </span>
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(pendingFile.previewUrl);
                  setPendingFile(null);
                }}
                className="p-1 text-[#667781] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-black flex items-center justify-center max-h-[55dvh] overflow-hidden">
              {pendingFile.kind === 'video' ? (
                <video
                  src={pendingFile.previewUrl}
                  controls
                  playsInline
                  className="max-h-[55dvh] max-w-full"
                />
              ) : (
                <img
                  src={pendingFile.previewUrl}
                  alt="Upload preview"
                  className="max-h-[55dvh] max-w-full object-contain"
                />
              )}
            </div>

            {uploadProgress !== null && (
              <div className="px-5 pt-3">
                <div className="h-1.5 w-full rounded-full bg-[#E9EDEF] dark:bg-[#202C33] overflow-hidden">
                  <div
                    className="h-full bg-[#00A884] transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="text-[11px] font-mono tabular-nums text-[#667781] mt-1">
                  Uploading {uploadProgress}%
                </div>
              </div>
            )}

            <div className="p-4 flex items-center gap-2">
              <input
                type="text"
                maxLength={BLUEPRINT_LIMITS.MESSAGE_TEXT_MAX}
                value={pendingFile.caption}
                onChange={(e) =>
                  setPendingFile((prev) =>
                    prev ? { ...prev, caption: e.target.value } : null
                  )
                }
                placeholder="Add a caption..."
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
              />
              <button
                type="button"
                disabled={sending}
                onClick={handleConfirmMediaSend}
                className="min-w-[46px] min-h-[44px] px-4 rounded-xl bg-[#00A884] hover:bg-[#008F70] text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>Send</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxMedia && (
        <MediaLightbox
          url={lightboxMedia.url}
          type={lightboxMedia.type}
          name={lightboxMedia.name}
          onClose={() => setLightboxMedia(null)}
        />
      )}

      {/* Wallpaper Modal */}
      {showWallpaperModal && (
        <WallpaperModal
          chatId={chat.id}
          chatTitle={chatDisplayName}
          darkMode={darkMode}
          onClose={() => setShowWallpaperModal(false)}
        />
      )}

      {/* Report Modal */}
      {reportTarget && (
        <ReportModal
          reportType={reportTarget.reportType}
          reportedUid={reportTarget.reportedUid}
          reportedName={reportTarget.reportedName}
          chatId={chat.id}
          chatCollection={chatCollection as ChatCollection}
          messageId={reportTarget.messageId}
          messageTextSnippet={reportTarget.messageTextSnippet}
          surroundingMessages={reportTarget.surroundingMessages}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}
