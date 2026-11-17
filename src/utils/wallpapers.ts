export interface WallpaperPreset {
  id: string;
  label: string;
  lightBg: string;
  darkBg: string;
  lightStroke: string;
  darkStroke: string;
  hasPattern: boolean;
}

export interface WallpaperSetting {
  presetId: string;
  customUrl?: string;
  dimOpacity?: number; // 0 to 0.75
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    id: 'default',
    label: 'Classic Pattern',
    lightBg: '#EFEAE2',
    darkBg: '#0B141A',
    lightStroke: '#D1C9BC',
    darkStroke: '#1E2C34',
    hasPattern: true,
  },
  {
    id: 'sage',
    label: 'Sage Meadow',
    lightBg: '#DCE7DC',
    darkBg: '#0D1B17',
    lightStroke: '#B6CCB7',
    darkStroke: '#1B332C',
    hasPattern: true,
  },
  {
    id: 'ocean',
    label: 'Slate Ocean',
    lightBg: '#DCE7F0',
    darkBg: '#0C1622',
    lightStroke: '#B5C9DA',
    darkStroke: '#1C2E42',
    hasPattern: true,
  },
  {
    id: 'sand',
    label: 'Warm Sand',
    lightBg: '#EDE4D3',
    darkBg: '#191510',
    lightStroke: '#CFC0A7',
    darkStroke: '#2E271E',
    hasPattern: true,
  },
  {
    id: 'lavender',
    label: 'Dusk Lavender',
    lightBg: '#E6E2F0',
    darkBg: '#141220',
    lightStroke: '#C4BDD8',
    darkStroke: '#26233B',
    hasPattern: true,
  },
  {
    id: 'rose',
    label: 'Soft Clay',
    lightBg: '#EFE2E2',
    darkBg: '#1D1214',
    lightStroke: '#D5BDBD',
    darkStroke: '#352225',
    hasPattern: true,
  },
  {
    id: 'minimal',
    label: 'Clean Solid',
    lightBg: '#F4F6F8',
    darkBg: '#0D1117',
    lightStroke: '#F4F6F8',
    darkStroke: '#0D1117',
    hasPattern: false,
  },
];

export function buildPatternSvgDataUri(strokeHex: string): string {
  const encodedStroke = encodeURIComponent(strokeHex);
  return `url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' stroke='${encodedStroke}' stroke-width='1' stroke-opacity='0.5'%3E%3Ccircle cx='16' cy='16' r='5'/%3E%3Cpath d='M52 12l8 8-8 8-8-8z'/%3E%3Cpath d='M12 56c4-6 12-6 16 0'/%3E%3Crect x='50' y='48' width='12' height='12' rx='3'/%3E%3Ccircle cx='40' cy='38' r='2.5'/%3E%3C/g%3E%3C/svg%3E")`;
}

export function getWallpaperStorageKey(uid: string, chatId?: string): string {
  return chatId ? `verdechat_wp_${uid}_${chatId}` : `verdechat_wp_${uid}`;
}

export function loadWallpaperSetting(uid: string, chatId?: string): WallpaperSetting {
  if (typeof window === 'undefined') return { presetId: 'default', dimOpacity: 0.25 };
  try {
    if (chatId) {
      const chatRaw = localStorage.getItem(getWallpaperStorageKey(uid, chatId));
      if (chatRaw) return JSON.parse(chatRaw) as WallpaperSetting;
    }
    const globalRaw = localStorage.getItem(getWallpaperStorageKey(uid));
    if (globalRaw) return JSON.parse(globalRaw) as WallpaperSetting;
  } catch {
    // Ignore malformed storage
  }
  return { presetId: 'default', dimOpacity: 0.25 };
}

export function saveWallpaperSetting(
  uid: string,
  setting: WallpaperSetting | null,
  chatId?: string
): void {
  if (typeof window === 'undefined') return;
  const key = getWallpaperStorageKey(uid, chatId);
  if (!setting) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, JSON.stringify(setting));
  }
  window.dispatchEvent(new CustomEvent('verdechat-wallpaper-changed'));
}
