import React, { useState } from 'react';
import { Bell, Camera, Check, Loader2, LogOut, Moon, Palette, Shield, ShieldCheck, Sun, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { BLUEPRINT_LIMITS } from '../types';
import { uploadChatMedia } from '../services/media';
import { Avatar } from './Avatar';
import { WallpaperModal } from './WallpaperModal';
import { ModerationPolicyModal } from './ModerationPolicyModal';

interface SettingsModalProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAdmin?: () => void;
  onClose: () => void;
}

export function SettingsModal({
  darkMode,
  onToggleDarkMode,
  onOpenAdmin,
  onClose,
}: SettingsModalProps) {
  const {
    publicProfile,
    privateUser,
    firebaseUser,
    isAdmin,
    isSuperAdmin,
    updateProfile,
    enablePushNotifications,
    signOut,
  } = useAuth();

  const [displayName, setDisplayName] = useState(publicProfile?.displayName || '');
  const [about, setAbout] = useState(publicProfile?.about || '');
  const [photoURL, setPhotoURL] = useState(publicProfile?.photoURL || '');
  const [isDiscoverable, setIsDiscoverable] = useState(publicProfile?.isDiscoverable ?? true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notifStatus, setNotifStatus] = useState<string | null>(null);
  const [savedFlag, setSavedFlag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !firebaseUser) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadChatMedia(file, `avatars/${firebaseUser.uid}`, file.name);
      setPhotoURL(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload avatar');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ displayName, about, photoURL, isDiscoverable });
      setSavedFlag(true);
      window.setTimeout(() => setSavedFlag(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleEnableNotifications = async () => {
    const res = await enablePushNotifications();
    if (res.granted) {
      setNotifStatus(
        res.tokenSaved
          ? 'Browser notifications & FCM push token active.'
          : 'Browser notifications enabled for incoming messages and calls.'
      );
    } else {
      setNotifStatus('Notification permission was blocked in browser settings.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Account and app settings"
    >
      <div className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[88dvh]">
        <div className="px-5 py-4 border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#111B21] dark:text-[#E9EDEF]">
            Profile & Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="min-w-[36px] min-h-[36px] rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] flex items-center justify-center text-[#54656F] dark:text-[#8696A0] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar src={photoURL} name={displayName || 'User'} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-[#111B21] dark:text-[#E9EDEF] truncate">
                  @{publicProfile?.username}
                </div>
                <div className="text-xs text-[#667781] dark:text-[#8696A0] truncate mb-2">
                  {privateUser?.email}
                </div>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D1D7DB] dark:border-[#2A3942] text-xs font-medium text-[#111B21] dark:text-[#E9EDEF] hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] cursor-pointer">
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  <span>{uploading ? 'Uploading...' : 'Change avatar'}</span>
                  <input type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
                </label>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                Display Name
              </label>
              <input
                type="text"
                required
                maxLength={BLUEPRINT_LIMITS.DISPLAY_NAME_MAX}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#54656F] dark:text-[#8696A0] mb-1">
                About
              </label>
              <input
                type="text"
                maxLength={BLUEPRINT_LIMITS.ABOUT_MAX}
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-sm text-[#111B21] dark:text-[#E9EDEF] outline-none"
              />
            </div>

            <label className="flex items-center gap-2.5 text-xs text-[#54656F] dark:text-[#8696A0] cursor-pointer">
              <input
                type="checkbox"
                checked={isDiscoverable}
                onChange={(e) => setIsDiscoverable(e.target.checked)}
                className="rounded accent-[#00A884] w-4 h-4"
              />
              <span>Visible in directory search</span>
            </label>

            <button
              type="submit"
              disabled={saving}
              className="w-full min-h-[42px] px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : savedFlag ? (
                <Check className="w-4 h-4" />
              ) : null}
              <span>{savedFlag ? 'Profile Saved' : 'Save Changes'}</span>
            </button>
          </form>

          <div className="pt-4 border-t border-[#E9EDEF] dark:border-[#222E35] space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF]">
                  Appearance
                </div>
                <div className="text-xs text-[#667781] dark:text-[#8696A0]">
                  Switch between light and dark interface
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleDarkMode}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] cursor-pointer"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{darkMode ? 'Light' : 'Dark'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF]">
                  Chat Wallpaper
                </div>
                <div className="text-xs text-[#667781] dark:text-[#8696A0]">
                  Choose colors, patterns, or upload a photo
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowWallpaperModal(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] cursor-pointer"
              >
                <Palette className="w-4 h-4" />
                <span>Change</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF]">
                  Push Notifications
                </div>
                <div className="text-xs text-[#667781] dark:text-[#8696A0]">
                  Alerts for new messages and incoming calls
                </div>
              </div>
              <button
                type="button"
                onClick={handleEnableNotifications}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#00A884]/12 text-[#008069] dark:text-[#00A884] text-xs font-semibold cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                <span>
                  {typeof Notification !== 'undefined' && Notification.permission === 'granted'
                    ? 'Active'
                    : 'Enable'}
                </span>
              </button>
            </div>

            {notifStatus && (
              <p className="text-xs text-[#008069] dark:text-[#00A884]">{notifStatus}</p>
            )}

            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF]">
                  Privacy &amp; Moderation Policy
                </div>
                <div className="text-xs text-[#667781] dark:text-[#8696A0]">
                  How private chats and reports are protected
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPolicyModal(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33] text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF] cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>View</span>
              </button>
            </div>

            {isSuperAdmin && onOpenAdmin && (
              <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#E9EDEF] dark:border-[#222E35]">
                <div>
                  <div className="text-sm font-medium text-[#111B21] dark:text-[#E9EDEF]">
                    Owner Monitoring Console
                  </div>
                  <div className="text-xs text-[#667781] dark:text-[#8696A0]">
                    Conversations, user analytics, moderation &amp; privacy settings
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAdmin();
                  }}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold cursor-pointer"
                >
                  <Shield className="w-4 h-4" />
                  <span>Open</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 bg-[#F8FAFB] dark:bg-[#162127] border-t border-[#E9EDEF] dark:border-[#222E35] flex justify-end">
          <button
            type="button"
            onClick={async () => {
              await signOut();
              onClose();
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-500/10 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>

      {showWallpaperModal && (
        <WallpaperModal
          darkMode={darkMode}
          onClose={() => setShowWallpaperModal(false)}
        />
      )}

      {showPolicyModal && (
        <ModerationPolicyModal onClose={() => setShowPolicyModal(false)} />
      )}
    </div>
  );
}
