import React, { useState } from 'react';
import { Loader2, Phone, Search, Video, X } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { BLUEPRINT_LIMITS, type CallType, type PublicProfile } from '../types';
import { Avatar } from './Avatar';

interface NewVoiceCallModalProps {
  directoryUsers: PublicProfile[];
  onStartCallWithPeer: (peer: PublicProfile, callType: CallType) => Promise<void>;
  onClose: () => void;
}

export function NewVoiceCallModal({
  directoryUsers,
  onStartCallWithPeer,
  onClose,
}: NewVoiceCallModalProps) {
  const { publicProfile } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [exactMatch, setExactMatch] = useState<PublicProfile | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const others = directoryUsers.filter((u) => u.uid !== publicProfile?.uid);
  const filtered = others.filter((u) => {
    const q = searchQuery.trim().toLowerCase().replace(/^@/, '');
    if (!q) return true;
    return (
      u.displayName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q)
    );
  });

  const handleExactLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = searchQuery.trim().toLowerCase().replace(/^@/, '');
    if (!BLUEPRINT_LIMITS.USERNAME_PATTERN.test(clean)) {
      setLookupError('Enter a valid handle (3–24 lowercase letters, numbers, or underscores).');
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    setExactMatch(null);
    try {
      const unameSnap = await getDoc(doc(db, 'usernames', clean));
      if (!unameSnap.exists()) {
        setLookupError(`No user found with handle @${clean}.`);
        return;
      }
      const uid = unameSnap.data().uid as string;
      if (uid === publicProfile?.uid) {
        setLookupError('That is your own handle.');
        return;
      }
      const profSnap = await getDoc(doc(db, 'publicProfiles', uid));
      if (!profSnap.exists()) {
        setLookupError('User profile is unavailable.');
        return;
      }
      setExactMatch(profSnap.data() as PublicProfile);
    } catch {
      setLookupError('Could not look up that handle right now.');
    } finally {
      setLookupLoading(false);
    }
  };

  const triggerCall = async (peer: PublicProfile, callType: CallType) => {
    if (busyUid) return;
    setBusyUid(peer.uid);
    try {
      await onStartCallWithPeer(peer, callType);
      onClose();
    } finally {
      setBusyUid(null);
    }
  };

  const renderPersonRow = (person: PublicProfile, subtitleSuffix?: string) => (
    <div
      key={person.uid}
      className="flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Avatar src={person.photoURL} name={person.displayName} isOnline={person.isOnline} />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
            {person.displayName}
          </div>
          <div className="text-xs text-[#667781] dark:text-[#8696A0] truncate">
            @{person.username}
            {subtitleSuffix ? ` · ${subtitleSuffix}` : person.about ? ` · ${person.about}` : ''}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          disabled={Boolean(busyUid)}
          onClick={() => triggerCall(person, 'audio')}
          aria-label={`Voice call ${person.displayName}`}
          title="Start voice call"
          className="min-w-[40px] min-h-[40px] rounded-full bg-[#00A884]/12 hover:bg-[#00A884]/20 text-[#008069] dark:text-[#00A884] flex items-center justify-center cursor-pointer disabled:opacity-50"
        >
          {busyUid === person.uid ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Phone className="w-4 h-4" />
          )}
        </button>

        <button
          type="button"
          disabled={Boolean(busyUid)}
          onClick={() => triggerCall(person, 'video')}
          aria-label={`Video call ${person.displayName}`}
          title="Start video call"
          className="min-w-[40px] min-h-[40px] rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-[#54656F] dark:text-[#AEBAC1] flex items-center justify-center cursor-pointer disabled:opacity-50"
        >
          <Video className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Start a voice call"
    >
      <div className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[82dvh]">
        <div className="px-5 py-4 border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              New Voice Call
            </h2>
            <p className="text-xs text-[#667781] dark:text-[#8696A0]">
              Browser-to-browser HD internet calling — no SIM card needed
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close voice call modal"
            className="min-w-[36px] min-h-[36px] rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] flex items-center justify-center text-[#54656F] dark:text-[#8696A0] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleExactLookup} className="px-5 py-3 flex items-center gap-2 border-b border-[#E9EDEF] dark:border-[#222E35]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#667781] dark:text-[#8696A0] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setLookupError(null);
              }}
              placeholder="Search contact or exact @handle"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={lookupLoading || !searchQuery.trim()}
            className="px-3 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] hover:bg-[#E9EDEF] dark:hover:bg-[#2A3942] text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] shrink-0 cursor-pointer disabled:opacity-50"
          >
            {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Find @'}
          </button>
        </form>

        {lookupError && (
          <div className="px-5 pt-2 text-xs text-red-600 dark:text-red-400">{lookupError}</div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {exactMatch && renderPersonRow(exactMatch, 'Exact handle match')}

          {filtered.length === 0 ? (
            <div className="py-10 px-4 text-center">
              <p className="text-sm text-[#54656F] dark:text-[#8696A0]">
                No discoverable contacts match your search yet.
              </p>
              <p className="text-xs text-[#667781] dark:text-[#8696A0] mt-1">
                Search an exact @handle above or invite someone to join VerdeChat.
              </p>
            </div>
          ) : (
            filtered.map((person) => renderPersonRow(person))
          )}
        </div>
      </div>
    </div>
  );
}
