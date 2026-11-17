import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Camera,
  CheckCircle2,
  Flag,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  Moon,
  Palette,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Search,
  Settings,
  Shield,
  Sun,
  Users,
  Video,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useCall } from '../contexts/CallContext';
import type { CallType, ChatThread, PublicProfile } from '../types';
import {
  formatChatListTime,
  getDirectChatId,
} from '../utils/chatHelpers';
import { showBrowserNotification, subscribeForegroundFcm } from '../services/messaging';
import { createGroupChat, GROUP_CHAT_COLLECTION } from '../services/groupChats';
import { incrementSystemStat } from '../services/moderation';
import { Avatar } from './Avatar';
import { ChatArea } from './ChatArea';
import { NewChatModal } from './NewChatModal';
import { NewVoiceCallModal } from './NewVoiceCallModal';
import { SettingsModal } from './SettingsModal';
import { CallOverlay } from './CallOverlay';
import { WallpaperModal } from './WallpaperModal';
import { AdminDashboard } from './AdminDashboard';
import { ReportModal } from './ReportModal';
import { ModerationPolicyModal } from './ModerationPolicyModal';

interface ChatWorkspaceProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenOwnerConsole?: () => void;
}

export function ChatWorkspace({
  darkMode,
  onToggleDarkMode,
  onOpenOwnerConsole,
}: ChatWorkspaceProps) {
  const {
    publicProfile,
    enablePushNotifications,
    justSignedInWelcome,
    dismissWelcomeBanner,
    isSuperAdmin,
    websiteSettings,
  } = useAuth();
  const { callHistory, startCall, activeCall } = useCall();

  const [directAndLegacyChats, setDirectAndLegacyChats] = useState<ChatThread[]>([]);
  const [groupChats, setGroupChats] = useState<ChatThread[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<PublicProfile[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, PublicProfile>>({});
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'chats' | 'calls' | 'people'>('chats');
  const [chatFilter, setChatFilter] = useState<'all' | 'groups'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showNewVoiceCallModal, setShowNewVoiceCallModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [reportTargetUser, setReportTargetUser] = useState<PublicProfile | null>(null);
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const prevChatTimesRef = useRef<Record<string, number>>({});
  const initialSyncDoneRef = useRef(false);

  useEffect(() => {
    if (!justSignedInWelcome) return;
    const t = window.setTimeout(() => dismissWelcomeBanner(), 5500);
    return () => window.clearTimeout(t);
  }, [justSignedInWelcome, dismissWelcomeBanner]);

  // Foreground FCM message subscription
  useEffect(() => {
    let unsub = () => {};
    void subscribeForegroundFcm((payload) => {
      const title = payload.notification?.title || 'VerdeChat';
      const body = payload.notification?.body || 'New message received';
      if (document.hidden) {
        showBrowserNotification(title, body);
      }
    }).then((fn) => {
      unsub = fn;
    });
    return () => unsub();
  }, []);

  // Listen to user's direct/legacy chats in `chats` collection
  useEffect(() => {
    if (!publicProfile) return;
    const q = query(
      collection(db, 'chats'),
      where('participantIds', 'array-contains', publicProfile.uid)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ChatThread[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ChatThread, 'id'>),
          sourceCollection: 'chats',
        }));
        setDirectAndLegacyChats(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'chats');
      }
    );

    return () => unsub();
  }, [publicProfile]);

  // Listen to user's multi-participant group chats in `groupChat` collection
  useEffect(() => {
    if (!publicProfile) return;
    const q = query(
      collection(db, GROUP_CHAT_COLLECTION),
      where('participantIds', 'array-contains', publicProfile.uid)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ChatThread[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ChatThread, 'id'>),
          sourceCollection: GROUP_CHAT_COLLECTION,
        }));
        setGroupChats(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, GROUP_CHAT_COLLECTION);
      }
    );

    return () => unsub();
  }, [publicProfile]);

  // Merge and sort chats + groupChat threads, and dispatch incoming message alerts
  const chats = useMemo(() => {
    const merged = [...directAndLegacyChats, ...groupChats];
    merged.sort((a, b) => {
      const tA = a.lastMessageAt?.toMillis?.() ?? 0;
      const tB = b.lastMessageAt?.toMillis?.() ?? 0;
      return tB - tA;
    });
    return merged;
  }, [directAndLegacyChats, groupChats]);

  useEffect(() => {
    if (!publicProfile) return;
    if (initialSyncDoneRef.current) {
      chats.forEach((c) => {
        const msgMs = c.lastMessageAt?.toMillis?.() ?? 0;
        const prevMs = prevChatTimesRef.current[c.id] ?? 0;
        if (
          msgMs > prevMs &&
          c.lastMessageSenderId &&
          c.lastMessageSenderId !== publicProfile.uid &&
          (document.hidden || c.id !== selectedChatId)
        ) {
          const sender = profilesMap[c.lastMessageSenderId];
          const title = c.type === 'group' ? c.title : sender?.displayName || 'New message';
          showBrowserNotification(title, c.lastMessageText || 'Sent an attachment', c.id);
        }
      });
    }

    const nextTimes: Record<string, number> = {};
    chats.forEach((c) => {
      nextTimes[c.id] = c.lastMessageAt?.toMillis?.() ?? 0;
    });
    prevChatTimesRef.current = nextTimes;
    if (chats.length > 0) {
      initialSyncDoneRef.current = true;
    }
  }, [chats, publicProfile, selectedChatId, profilesMap]);

  // Listen to discoverable publicProfiles
  useEffect(() => {
    if (!publicProfile) return;
    const q = query(
      collection(db, 'publicProfiles'),
      where('isDiscoverable', '==', true)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const users: PublicProfile[] = snap.docs.map((d) => d.data() as PublicProfile);
        setDirectoryUsers(users);
        setProfilesMap((prev) => {
          const next = { ...prev };
          users.forEach((u) => {
            next[u.uid] = u;
          });
          return next;
        });
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'publicProfiles');
      }
    );

    return () => unsub();
  }, [publicProfile]);

  // Fetch any missing participant profiles referenced in chats
  useEffect(() => {
    if (!publicProfile) return;
    const neededUids = new Set<string>();
    chats.forEach((c) => {
      c.participantIds.forEach((uid) => {
        if (!profilesMap[uid]) neededUids.add(uid);
      });
    });
    if (neededUids.size === 0) return;

    void Promise.all(
      Array.from(neededUids).map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'publicProfiles', uid));
          if (snap.exists()) {
            return snap.data() as PublicProfile;
          }
        } catch {
          // Ignore unreachable profile
        }
        return null;
      })
    ).then((fetched) => {
      const valid = fetched.filter((p): p is PublicProfile => Boolean(p));
      if (valid.length === 0) return;
      setProfilesMap((prev) => {
        const next = { ...prev };
        valid.forEach((p) => {
          next[p.uid] = p;
        });
        return next;
      });
    });
  }, [chats, profilesMap, publicProfile]);

  const selectedChat = useMemo(
    () => chats.find((c) => c.id === selectedChatId) || null,
    [chats, selectedChatId]
  );

  const ensureDirectChatExists = async (peer: PublicProfile): Promise<string | null> => {
    if (!publicProfile) return null;
    const chatId = getDirectChatId(publicProfile.uid, peer.uid);
    const existing = chats.find((c) => c.id === chatId);
    if (!existing) {
      const chatRef = doc(db, 'chats', chatId);
      try {
        const snap = await getDoc(chatRef);
        if (!snap.exists()) {
          await setDoc(chatRef, {
            type: 'direct',
            title: '',
            photoURL: '',
            participantIds: [publicProfile.uid, peer.uid].sort(),
            createdBy: publicProfile.uid,
            lastMessageText: '',
            lastMessageType: 'text',
            lastMessageSenderId: '',
            lastMessageAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          void incrementSystemStat('totalChats');
        }
        setProfilesMap((prev) => ({ ...prev, [peer.uid]: peer }));
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `chats/${chatId}`);
        return null;
      }
    }
    return chatId;
  };

  const handleOpenOrCreateDirectChat = async (peer: PublicProfile) => {
    const chatId = await ensureDirectChatExists(peer);
    if (!chatId) return;
    setSelectedChatId(chatId);
    setSidebarTab('chats');
  };

  const handleStartCallWithPeer = async (peer: PublicProfile, callType: CallType) => {
    const chatId = await ensureDirectChatExists(peer);
    if (!chatId) return;
    await startCall(peer, chatId, callType);
  };

  const handleCreateGroupChat = async (
    title: string,
    memberUids: string[],
    description?: string
  ) => {
    if (!publicProfile) return;
    const groupId = await createGroupChat({
      title,
      description,
      memberUids,
      creator: publicProfile,
    });
    setSelectedChatId(groupId);
    setSidebarTab('chats');
  };

  const filteredChats = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return chats.filter((c) => {
      if (chatFilter === 'groups' && c.type !== 'group') return false;
      if (!q) return true;
      if (c.type === 'group') {
        const participantMatch = c.participantIds.some((uid) => {
          const p = profilesMap[uid];
          return (
            (p?.displayName || '').toLowerCase().includes(q) ||
            (p?.username || '').toLowerCase().includes(q)
          );
        });
        return (
          c.title.toLowerCase().includes(q) ||
          (c.description || '').toLowerCase().includes(q) ||
          c.lastMessageText.toLowerCase().includes(q) ||
          participantMatch
        );
      }
      const peerUid = c.participantIds.find((id) => id !== publicProfile?.uid);
      const peer = peerUid ? profilesMap[peerUid] : undefined;
      return (
        (peer?.displayName || '').toLowerCase().includes(q) ||
        (peer?.username || '').toLowerCase().includes(q) ||
        c.lastMessageText.toLowerCase().includes(q)
      );
    });
  }, [chats, chatFilter, searchTerm, publicProfile?.uid, profilesMap]);

  const directoryOthers = useMemo(
    () =>
      directoryUsers
        .filter((u) => u.uid !== publicProfile?.uid)
        .filter((u) => {
          const q = searchTerm.trim().toLowerCase().replace(/^@/, '');
          if (!q) return true;
          return (
            u.displayName.toLowerCase().includes(q) ||
            u.username.toLowerCase().includes(q)
          );
        }),
    [directoryUsers, publicProfile?.uid, searchTerm]
  );

  const showNotifPrompt =
    !notifBannerDismissed &&
    typeof Notification !== 'undefined' &&
    Notification.permission === 'default';

  const renderMessageSnippetIcon = (type: ChatThread['lastMessageType']) => {
    switch (type) {
      case 'image':
        return <Camera className="w-3.5 h-3.5 shrink-0" />;
      case 'video':
        return <Video className="w-3.5 h-3.5 shrink-0" />;
      case 'audio':
        return <Mic className="w-3.5 h-3.5 shrink-0" />;
      case 'call':
        return <PhoneCall className="w-3.5 h-3.5 shrink-0" />;
      default:
        return null;
    }
  };

  return (
    <div className="h-dvh w-full bg-[#DADBD3] dark:bg-[#0B141A] flex items-center justify-center overflow-hidden">
      <div className="w-full h-full max-w-[1600px] bg-white dark:bg-[#111B21] md:border-x border-[#E9EDEF] dark:border-[#222E35] flex overflow-hidden">
        {/* Left Navigation & List Pane */}
        <aside
          className={`${
            selectedChat ? 'hidden md:flex' : 'flex'
          } w-full md:w-[350px] lg:w-[390px] shrink-0 flex-col border-r border-[#E9EDEF] dark:border-[#222E35] bg-white dark:bg-[#111B21]`}
        >
          {/* Sidebar Top Bar */}
          <header className="h-[62px] shrink-0 px-4 bg-[#F0F2F5] dark:bg-[#202C33] flex items-center justify-between gap-3 border-b border-[#E9EDEF] dark:border-[#222E35]">
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="flex items-center gap-3 min-w-0 cursor-pointer text-left"
              aria-label="Open profile settings"
            >
              <Avatar
                src={publicProfile?.photoURL}
                name={publicProfile?.displayName || 'Me'}
                size="sm"
                isOnline
              />
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#111B21] dark:text-[#E9EDEF] truncate">
                  {websiteSettings.siteName || 'VerdeChat'}
                </div>
                <div className="text-[11px] text-[#667781] dark:text-[#8696A0] truncate">
                  @{publicProfile?.username}
                </div>
              </div>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() =>
                    onOpenOwnerConsole ? onOpenOwnerConsole() : setShowAdminDashboard(true)
                  }
                  aria-label="Open Owner Monitoring Console"
                  title="Owner Monitoring Console"
                  className="min-w-[40px] min-h-[40px] rounded-full bg-[#00A884]/12 hover:bg-[#00A884]/20 flex items-center justify-center text-[#008069] dark:text-[#00A884] cursor-pointer"
                >
                  <Shield className="w-5 h-5" />
                </button>
              )}

              <button
                type="button"
                onClick={onToggleDarkMode}
                aria-label="Toggle dark mode"
                title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                className="min-w-[40px] min-h-[40px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#54656F] dark:text-[#AEBAC1] cursor-pointer"
              >
                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>

              <button
                type="button"
                onClick={() => setShowNewChatModal(true)}
                aria-label="New chat or group"
                title="New chat or group"
                className="min-w-[40px] min-h-[40px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#54656F] dark:text-[#AEBAC1] cursor-pointer"
              >
                <MessageSquarePlus className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                aria-label="Settings"
                title="Settings"
                className="min-w-[40px] min-h-[40px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#54656F] dark:text-[#AEBAC1] cursor-pointer"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </header>

          {websiteSettings.welcomeNotice.trim() && !noticeDismissed && (
            <div className="px-4 py-2 bg-[#F8FAFB] dark:bg-[#162127] border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between gap-2 text-xs text-[#111B21] dark:text-[#E9EDEF]">
              <span className="truncate">{websiteSettings.welcomeNotice}</span>
              <button
                type="button"
                onClick={() => setNoticeDismissed(true)}
                aria-label="Dismiss announcement"
                className="text-[#667781] cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Optional Push Notification Prompt */}
          {showNotifPrompt && (
            <div className="px-4 py-2.5 bg-[#00A884]/10 border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Bell className="w-4 h-4 text-[#008069] dark:text-[#00A884] shrink-0" />
                <span className="text-xs text-[#111B21] dark:text-[#E9EDEF] truncate">
                  Enable browser alerts for messages & calls
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setNotifBannerDismissed(true)}
                  className="text-[11px] text-[#667781] px-1.5 py-1 cursor-pointer"
                >
                  Later
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await enablePushNotifications();
                    setNotifBannerDismissed(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#008069] text-white text-[11px] font-semibold cursor-pointer"
                >
                  Enable
                </button>
              </div>
            </div>
          )}

          {/* Search & Tabs */}
          <div className="p-3 space-y-2.5 border-b border-[#E9EDEF] dark:border-[#222E35]">
            <div className="relative">
              <Search className="w-4 h-4 text-[#667781] dark:text-[#8696A0] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search chats, people, or messages"
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] placeholder:text-[#667781] dark:placeholder:text-[#8696A0] outline-none"
              />
            </div>

            {/* Desktop/Tablet Navigation Switcher */}
            <div className="hidden md:grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33]">
              <button
                type="button"
                onClick={() => setSidebarTab('chats')}
                className={`py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  sidebarTab === 'chats'
                    ? 'bg-white dark:bg-[#111B21] text-[#008069] dark:text-[#00A884] shadow-xs'
                    : 'text-[#54656F] dark:text-[#8696A0]'
                }`}
              >
                Chats
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('calls')}
                className={`py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  sidebarTab === 'calls'
                    ? 'bg-white dark:bg-[#111B21] text-[#008069] dark:text-[#00A884] shadow-xs'
                    : 'text-[#54656F] dark:text-[#8696A0]'
                }`}
              >
                Calls
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('people')}
                className={`py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  sidebarTab === 'people'
                    ? 'bg-white dark:bg-[#111B21] text-[#008069] dark:text-[#00A884] shadow-xs'
                    : 'text-[#54656F] dark:text-[#8696A0]'
                }`}
              >
                Directory
              </button>
            </div>

            {sidebarTab === 'chats' && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setChatFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    chatFilter === 'all'
                      ? 'bg-[#00A884]/15 text-[#008069] dark:text-[#00A884]'
                      : 'bg-[#F0F2F5] dark:bg-[#202C33] text-[#54656F] dark:text-[#8696A0]'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setChatFilter('groups')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    chatFilter === 'groups'
                      ? 'bg-[#00A884]/15 text-[#008069] dark:text-[#00A884]'
                      : 'bg-[#F0F2F5] dark:bg-[#202C33] text-[#54656F] dark:text-[#8696A0]'
                  }`}
                >
                  Groups
                </button>
              </div>
            )}
          </div>

          {/* Scrollable List Body */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#E9EDEF]/60 dark:divide-[#222E35]/60">
            {sidebarTab === 'chats' && (
              <>
                {filteredChats.length === 0 ? (
                  <div className="py-12 px-6 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center mx-auto mb-3">
                      <MessageSquare className="w-6 h-6" />
                    </div>
                    <h3 className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                      No conversations yet
                    </h3>
                    <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1 mb-4">
                      Start a direct chat or create a group with anyone on VerdeChat.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowNewChatModal(true)}
                      className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold cursor-pointer"
                    >
                      Start New Chat
                    </button>
                  </div>
                ) : (
                  filteredChats.map((chat) => {
                    const peerUid =
                      chat.type === 'direct'
                        ? chat.participantIds.find((id) => id !== publicProfile?.uid)
                        : undefined;
                    const peer = peerUid ? profilesMap[peerUid] : undefined;
                    const title =
                      chat.type === 'group'
                        ? chat.title || 'Group Chat'
                        : peer?.displayName || 'VerdeChat User';
                    const isSelected = chat.id === selectedChatId;

                    return (
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => setSelectedChatId(chat.id)}
                        className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[#F0F2F5] dark:bg-[#2A3942]'
                            : 'hover:bg-[#F5F6F6] dark:hover:bg-[#202C33]'
                        }`}
                      >
                        <Avatar
                          src={chat.type === 'group' ? chat.photoURL : peer?.photoURL}
                          name={title}
                          isOnline={peer?.isOnline}
                          isGroup={chat.type === 'group'}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                              {title}
                            </span>
                            <span className="text-[11px] font-mono tabular-nums text-[#667781] dark:text-[#8696A0] shrink-0">
                              {formatChatListTime(chat.lastMessageAt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-[#667781] dark:text-[#8696A0] mt-0.5 truncate">
                            {renderMessageSnippetIcon(chat.lastMessageType)}
                            <span className="truncate">
                              {chat.type === 'group'
                                ? `${chat.participantIds.length} members · ${chat.lastMessageText || 'Group chat'}`
                                : chat.lastMessageText || 'Tap to start messaging'}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </>
            )}

            {sidebarTab === 'calls' && (
              <>
                <div className="px-4 py-2.5 flex items-center justify-between gap-2 bg-[#F8FAFB] dark:bg-[#162127]">
                  <span className="text-xs font-medium text-[#667781] dark:text-[#8696A0]">
                    Browser Voice & Video Calls
                  </span>
                  <button
                    type="button"
                    disabled={Boolean(activeCall)}
                    onClick={() => setShowNewVoiceCallModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#008069] hover:bg-[#006B57] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    <span>New Voice Call</span>
                  </button>
                </div>

                {callHistory.length === 0 ? (
                  <div className="py-12 px-6 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center mx-auto mb-3">
                      <PhoneCall className="w-6 h-6" />
                    </div>
                    <h3 className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                      No call history yet
                    </h3>
                    <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1 mb-4">
                      Place a browser-to-browser voice or video call with anyone on VerdeChat.
                    </p>
                    <button
                      type="button"
                      disabled={Boolean(activeCall)}
                      onClick={() => setShowNewVoiceCallModal(true)}
                      className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Start Voice Call</span>
                    </button>
                  </div>
                ) : (
                  callHistory.map((c) => {
                    const isOutgoing = c.callerId === publicProfile?.uid;
                    const peerUid = isOutgoing ? c.calleeId : c.callerId;
                    const peerName = isOutgoing ? c.calleeName : c.callerName;
                    const peerPhoto = isOutgoing ? c.calleePhoto : c.callerPhoto;
                    const peerProfile = profilesMap[peerUid];
                    const isMissed = c.status === 'missed' || c.status === 'declined';

                    return (
                      <div
                        key={c.id}
                        className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#F5F6F6] dark:hover:bg-[#202C33]"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar src={peerPhoto} name={peerName} isOnline={peerProfile?.isOnline} />
                          <div className="min-w-0">
                            <div
                              className={`text-sm font-semibold truncate ${
                                isMissed
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-[#111B21] dark:text-[#E9EDEF]'
                              }`}
                            >
                              {peerName}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-[#667781] dark:text-[#8696A0]">
                              {isMissed ? (
                                <PhoneMissed className="w-3.5 h-3.5 text-red-500" />
                              ) : isOutgoing ? (
                                <PhoneOutgoing className="w-3.5 h-3.5 text-[#00A884]" />
                              ) : (
                                <PhoneIncoming className="w-3.5 h-3.5 text-[#00A884]" />
                              )}
                              <span>
                                {c.callType === 'video' ? 'Video' : 'Voice'} ·{' '}
                                {formatChatListTime(c.createdAt)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {peerProfile && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={Boolean(activeCall)}
                              onClick={() => startCall(peerProfile, c.chatId, 'audio')}
                              aria-label={`Voice call ${peerName}`}
                              title="Voice call"
                              className="min-w-[40px] min-h-[40px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#008069] dark:text-[#00A884] cursor-pointer disabled:opacity-40"
                            >
                              <Phone className="w-4 h-4" />
                            </button>
                            {c.callType === 'video' && (
                              <button
                                type="button"
                                disabled={Boolean(activeCall)}
                                onClick={() => startCall(peerProfile, c.chatId, 'video')}
                                aria-label={`Video call ${peerName}`}
                                title="Video call"
                                className="min-w-[40px] min-h-[40px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#54656F] dark:text-[#AEBAC1] cursor-pointer disabled:opacity-40"
                              >
                                <Video className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </>
            )}

            {sidebarTab === 'people' && (
              <>
                {directoryOthers.length === 0 ? (
                  <div className="py-12 px-6 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center mx-auto mb-3">
                      <Users className="w-6 h-6" />
                    </div>
                    <h3 className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                      Directory is quiet
                    </h3>
                    <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1 mb-4">
                      Invite friends to open this website, or use New Chat to find someone by exact @handle.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowNewChatModal(true)}
                      className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold cursor-pointer"
                    >
                      Find by @handle
                    </button>
                  </div>
                ) : (
                  directoryOthers.map((person) => (
                    <div
                      key={person.uid}
                      className="px-4 py-3 flex items-center gap-3 hover:bg-[#F5F6F6] dark:hover:bg-[#202C33]"
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenOrCreateDirectChat(person)}
                        className="flex-1 flex items-center gap-3 text-left min-w-0 cursor-pointer"
                      >
                        <Avatar
                          src={person.photoURL}
                          name={person.displayName}
                          isOnline={person.isOnline}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                            {person.displayName}
                          </div>
                          <div className="text-xs text-[#667781] dark:text-[#8696A0] truncate">
                            @{person.username} · {person.about}
                          </div>
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(activeCall) || !websiteSettings.allowVoiceVideoCalls}
                        onClick={() => handleStartCallWithPeer(person, 'audio')}
                        aria-label={`Voice call ${person.displayName}`}
                        title={
                          websiteSettings.allowVoiceVideoCalls
                            ? `Voice call ${person.displayName}`
                            : 'Calls paused by admin'
                        }
                        className="min-w-[40px] min-h-[40px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-[#008069] dark:text-[#00A884] shrink-0 cursor-pointer disabled:opacity-40"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setReportTargetUser(person)}
                        aria-label={`Report ${person.displayName}`}
                        title={`Report ${person.displayName}`}
                        className="min-w-[36px] min-h-[36px] rounded-full hover:bg-amber-500/10 flex items-center justify-center text-[#667781] hover:text-amber-600 dark:hover:text-amber-400 shrink-0 cursor-pointer"
                      >
                        <Flag className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </>
            )}
          </div>

          {/* Mobile Bottom Navigation Bar */}
          <nav
            aria-label="Mobile navigation"
            className="md:hidden h-14 shrink-0 bg-[#F0F2F5] dark:bg-[#202C33] border-t border-[#E9EDEF] dark:border-[#222E35] grid grid-cols-3"
          >
            <button
              type="button"
              onClick={() => setSidebarTab('chats')}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                sidebarTab === 'chats'
                  ? 'text-[#008069] dark:text-[#00A884]'
                  : 'text-[#54656F] dark:text-[#8696A0]'
              }`}
            >
              <MessageSquare className="w-5 h-5" />
              <span>Chats</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('calls')}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                sidebarTab === 'calls'
                  ? 'text-[#008069] dark:text-[#00A884]'
                  : 'text-[#54656F] dark:text-[#8696A0]'
              }`}
            >
              <Phone className="w-5 h-5" />
              <span>Calls</span>
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('people')}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                sidebarTab === 'people'
                  ? 'text-[#008069] dark:text-[#00A884]'
                  : 'text-[#54656F] dark:text-[#8696A0]'
              }`}
            >
              <Users className="w-5 h-5" />
              <span>Directory</span>
            </button>
          </nav>
        </aside>

        {/* Right Active Chat Pane */}
        <main
          className={`${
            selectedChat ? 'flex' : 'hidden md:flex'
          } flex-1 flex-col min-w-0 bg-[#F0F2F5] dark:bg-[#222E35]`}
        >
          {selectedChat ? (
            <ChatArea
              chat={selectedChat}
              profilesMap={profilesMap}
              directoryUsers={directoryUsers}
              darkMode={darkMode}
              onBackMobile={() => setSelectedChatId(null)}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] flex items-center justify-center mb-5">
                <MessageSquare className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold text-[#111B21] dark:text-[#E9EDEF] tracking-tight text-balance">
                {websiteSettings.siteName || 'My Chat'} for Web
              </h1>
              <p className="text-sm text-[#667781] dark:text-[#8696A0] max-w-md mt-2 leading-relaxed">
                Select a conversation on the left or start a new chat to send messages, share photos and videos, record voice notes, and place browser-to-browser audio or video calls.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(true)}
                  className="px-5 py-2.5 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-sm font-semibold cursor-pointer transition-colors"
                >
                  Start a Conversation
                </button>
                <button
                  type="button"
                  disabled={Boolean(activeCall) || !websiteSettings.allowVoiceVideoCalls}
                  onClick={() => setShowNewVoiceCallModal(true)}
                  className="px-5 py-2.5 rounded-xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#2A3942] text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] inline-flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
                >
                  <Phone className="w-4 h-4 text-[#008069] dark:text-[#00A884]" />
                  <span>New Voice Call</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowWallpaperModal(true)}
                  className="px-5 py-2.5 rounded-xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#2A3942] text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] inline-flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <Palette className="w-4 h-4" />
                  <span>Change Wallpaper</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                  className="px-5 py-2.5 rounded-xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#2A3942] text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] cursor-pointer transition-colors"
                >
                  Profile & Notifications
                </button>
                <button
                  type="button"
                  onClick={() => setShowPolicyModal(true)}
                  className="px-5 py-2.5 rounded-xl bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#2A3942] text-sm font-medium text-[#111B21] dark:text-[#E9EDEF] inline-flex items-center gap-2 cursor-pointer transition-colors"
                >
                  <Shield className="w-4 h-4 text-[#008069] dark:text-[#00A884]" />
                  <span>Privacy Policy</span>
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Welcome Toast after Successful Login */}
      {justSignedInWelcome && (
        <div
          role="status"
          className="fixed top-4 right-4 z-50 bg-[#008069] text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 max-w-sm"
        >
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <div className="text-xs sm:text-sm font-semibold">
            Welcome to {websiteSettings.siteName || 'My Chat'}, {publicProfile?.displayName}!
          </div>
          <button
            type="button"
            onClick={dismissWelcomeBanner}
            aria-label="Dismiss welcome message"
            className="text-white/80 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Modals & Call Overlay */}
      {showNewChatModal && (
        <NewChatModal
          directoryUsers={directoryUsers}
          allowGroupCreation={websiteSettings.allowGroupCreation}
          onStartDirectChat={handleOpenOrCreateDirectChat}
          onCreateGroupChat={handleCreateGroupChat}
          onClose={() => setShowNewChatModal(false)}
        />
      )}

      {showNewVoiceCallModal && (
        <NewVoiceCallModal
          directoryUsers={directoryUsers}
          onStartCallWithPeer={handleStartCallWithPeer}
          onClose={() => setShowNewVoiceCallModal(false)}
        />
      )}

      {showSettingsModal && (
        <SettingsModal
          darkMode={darkMode}
          onToggleDarkMode={onToggleDarkMode}
          onOpenAdmin={
            isSuperAdmin
              ? () => (onOpenOwnerConsole ? onOpenOwnerConsole() : setShowAdminDashboard(true))
              : undefined
          }
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {showWallpaperModal && (
        <WallpaperModal
          darkMode={darkMode}
          onClose={() => setShowWallpaperModal(false)}
        />
      )}

      {showPolicyModal && (
        <ModerationPolicyModal onClose={() => setShowPolicyModal(false)} />
      )}

      {reportTargetUser && (
        <ReportModal
          reportType="user"
          reportedUid={reportTargetUser.uid}
          reportedName={reportTargetUser.displayName}
          onClose={() => setReportTargetUser(null)}
        />
      )}

      {isSuperAdmin && showAdminDashboard && (
        <AdminDashboard onClose={() => setShowAdminDashboard(false)} />
      )}

      <CallOverlay
        onOpenChat={(chatId) => {
          setSelectedChatId(chatId);
          setSidebarTab('chats');
        }}
      />
    </div>
  );
}
