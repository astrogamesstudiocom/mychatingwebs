import React, { useState } from 'react';
import { Check, ImagePlus, Loader2, RotateCcw, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { uploadChatMedia } from '../services/media';
import {
  loadWallpaperSetting,
  saveWallpaperSetting,
  WALLPAPER_PRESETS,
  type WallpaperSetting,
} from '../utils/wallpapers';

interface WallpaperModalProps {
  chatId?: string;
  chatTitle?: string;
  darkMode: boolean;
  onClose: () => void;
}

export function WallpaperModal({
  chatId,
  chatTitle,
  darkMode,
  onClose,
}: WallpaperModalProps) {
  const { publicProfile } = useAuth();
  const uid = publicProfile?.uid || 'guest';

  const [scope, setScope] = useState<'global' | 'chat'>(chatId ? 'chat' : 'global');
  const [setting, setSetting] = useState<WallpaperSetting>(() =>
    loadWallpaperSetting(uid, chatId)
  );
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applySetting = (next: WallpaperSetting) => {
    setSetting(next);
    saveWallpaperSetting(uid, next, scope === 'chat' ? chatId : undefined);
  };

  const handleUploadCustom = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (PNG, JPG, WebP).');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const res = await uploadChatMedia(file, `wallpapers/${uid}`, file.name);
      applySetting({
        presetId: 'custom',
        customUrl: res.url,
        dimOpacity: setting.dimOpacity ?? 0.3,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload wallpaper.');
    } finally {
      setUploading(false);
    }
  };

  const handleReset = () => {
    if (scope === 'chat' && chatId) {
      saveWallpaperSetting(uid, null, chatId);
      setSetting(loadWallpaperSetting(uid));
    } else {
      const def: WallpaperSetting = { presetId: 'default', dimOpacity: 0.25 };
      applySetting(def);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Chat Wallpaper Settings"
    >
      <div className="w-full max-w-md bg-white dark:bg-[#111B21] border border-[#E9EDEF] dark:border-[#222E35] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[88dvh]">
        <div className="px-5 py-4 border-b border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#111B21] dark:text-[#E9EDEF]">
              Chat Wallpaper
            </h2>
            {chatTitle && (
              <p className="text-xs text-[#667781] dark:text-[#8696A0] truncate">
                Customize background for {chatTitle} or all chats
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close wallpaper picker"
            className="min-w-[36px] min-h-[36px] rounded-full hover:bg-[#F0F2F5] dark:hover:bg-[#202C33] flex items-center justify-center text-[#54656F] dark:text-[#8696A0] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {chatId && (
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33]">
              <button
                type="button"
                onClick={() => setScope('chat')}
                className={`py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  scope === 'chat'
                    ? 'bg-white dark:bg-[#111B21] text-[#111B21] dark:text-[#E9EDEF] shadow-xs'
                    : 'text-[#54656F] dark:text-[#8696A0]'
                }`}
              >
                This chat only
              </button>
              <button
                type="button"
                onClick={() => setScope('global')}
                className={`py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  scope === 'global'
                    ? 'bg-white dark:bg-[#111B21] text-[#111B21] dark:text-[#E9EDEF] shadow-xs'
                    : 'text-[#54656F] dark:text-[#8696A0]'
                }`}
              >
                All chats
              </button>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold text-[#54656F] dark:text-[#8696A0] mb-3">
              Color & Pattern Themes
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
              {WALLPAPER_PRESETS.map((preset) => {
                const bg = darkMode ? preset.darkBg : preset.lightBg;
                const active = setting.presetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applySetting({ presetId: preset.id, dimOpacity: setting.dimOpacity ?? 0.25 })}
                    className={`group flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-colors cursor-pointer ${
                      active
                        ? 'border-[#00A884] bg-[#00A884]/8'
                        : 'border-[#E9EDEF] dark:border-[#222E35] hover:border-[#00A884]/50'
                    }`}
                  >
                    <div
                      className="w-full h-14 rounded-lg border border-black/10 dark:border-white/10 relative flex items-center justify-center"
                      style={{ backgroundColor: bg }}
                    >
                      {active && (
                        <span className="w-6 h-6 rounded-full bg-[#00A884] text-white flex items-center justify-center shadow-xs">
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-medium text-[#111B21] dark:text-[#E9EDEF] truncate w-full text-center">
                      {preset.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-2 border-t border-[#E9EDEF] dark:border-[#222E35] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-[#111B21] dark:text-[#E9EDEF]">
                  Custom Photo Wallpaper
                </h3>
                <p className="text-[11px] text-[#667781] dark:text-[#8696A0]">
                  Upload any photo from your device
                </p>
              </div>
              <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold cursor-pointer transition-colors">
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ImagePlus className="w-4 h-4" />
                )}
                <span>{uploading ? 'Uploading...' : 'Choose photo'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadCustom}
                  className="hidden"
                />
              </label>
            </div>

            {setting.presetId === 'custom' && setting.customUrl && (
              <div className="space-y-3 p-3 rounded-xl bg-[#F0F2F5] dark:bg-[#202C33]">
                <div className="h-28 rounded-lg overflow-hidden relative border border-black/10">
                  <img
                    src={setting.customUrl}
                    alt="Custom wallpaper preview"
                    className="w-full h-full object-cover"
                  />
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundColor: darkMode
                        ? `rgba(11, 20, 26, ${setting.dimOpacity ?? 0.35})`
                        : `rgba(255, 255, 255, ${setting.dimOpacity ?? 0.25})`,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center p-3">
                    <div className="px-3 py-1.5 rounded-xl bg-[#D9FDD3] dark:bg-[#005C4B] text-xs text-[#111B21] dark:text-[#E9EDEF] shadow-xs">
                      Message bubble preview
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-[11px] text-[#54656F] dark:text-[#8696A0] mb-1">
                    <span>Readability overlay</span>
                    <span className="font-mono tabular-nums">
                      {Math.round((setting.dimOpacity ?? 0.25) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.75}
                    step={0.05}
                    value={setting.dimOpacity ?? 0.25}
                    onChange={(e) =>
                      applySetting({
                        ...setting,
                        dimOpacity: parseFloat(e.target.value),
                      })
                    }
                    className="w-full accent-[#00A884] cursor-pointer"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 bg-[#F8FAFB] dark:bg-[#162127] border-t border-[#E9EDEF] dark:border-[#222E35] flex items-center justify-between">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#54656F] dark:text-[#8696A0] hover:text-[#111B21] dark:hover:text-white cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to default</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#008069] hover:bg-[#006B57] text-white text-xs font-semibold cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
