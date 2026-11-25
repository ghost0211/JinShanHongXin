export const TABLE_SKIN_OPTIONS = [
  {
    id: 'ink',
    label: '墨韵黛青',
    desc: '水墨黛青漆盘 · 朱砂点睛',
    swatch: 'linear-gradient(135deg, #2b4a44 0%, #0e1c1a 100%)',
    accent: '#c43c2c',
  },
  {
    id: 'cinnabar',
    label: '朱漆描金',
    desc: '东方朱漆牌桌 · 鎏金描边',
    swatch: 'linear-gradient(135deg, #8a2d27 0%, #250a09 100%)',
    accent: '#d6b26a',
  },
  {
    id: 'night-blue',
    label: '青花瓷蓝',
    desc: '海派青花釉色 · 瓷白牌背',
    swatch: 'linear-gradient(135deg, #2f5aa8 0%, #0b1530 100%)',
    accent: '#f4f6fb',
  },
] as const;

export type TableSkin = (typeof TABLE_SKIN_OPTIONS)[number]['id'];
export type HandLayoutMode = 'double' | 'single';
export type BotDifficulty = 'low' | 'medium' | 'high';

export const BOT_DIFFICULTY_OPTIONS: readonly {
  id: BotDifficulty;
  label: string;
  desc: string;
}[] = [
  { id: 'low', label: '低', desc: '轻松入门' },
  { id: 'medium', label: '中', desc: '休闲实战' },
  { id: 'high', label: '强', desc: '高智商搜索' },
];

export interface AppSettings {
  tableSkin: TableSkin;
  soundEnabled: boolean;
  soundVolume: number; // 0..100
  hapticsEnabled: boolean;
  splashEnabled: boolean;
  handLayout: HandLayoutMode;
  showCardBadges: boolean;
  showPointPips: boolean;
  autoSelectMandatory: boolean;
  hidePortraitBanner: boolean;
  allyBotDifficulty: BotDifficulty;
  opponentBotDifficulty: BotDifficulty;
}

const SETTINGS_KEY = 'jinshan.settings.v1';
const LEGACY_SKIN_KEY = 'jinshan.tableSkin';
const LEGACY_MUTE_KEY = 'jinshan_sound_muted';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  tableSkin: 'ink',
  soundEnabled: true,
  soundVolume: 82,
  hapticsEnabled: true,
  splashEnabled: true,
  handLayout: 'double',
  showCardBadges: true,
  showPointPips: true,
  autoSelectMandatory: true,
  hidePortraitBanner: false,
  allyBotDifficulty: 'high',
  opponentBotDifficulty: 'high',
};

export function isTableSkin(value: unknown): value is TableSkin {
  return TABLE_SKIN_OPTIONS.some((s) => s.id === value);
}

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return value === 'low' || value === 'medium' || value === 'high';
}

function clampVolume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function loadAppSettings(): AppSettings {
  const base: AppSettings = { ...DEFAULT_APP_SETTINGS };
  try {
    const legacySkin = window.localStorage.getItem(LEGACY_SKIN_KEY);
    if (isTableSkin(legacySkin)) base.tableSkin = legacySkin;
    const legacyMute = window.localStorage.getItem(LEGACY_MUTE_KEY);
    if (legacyMute === '1') base.soundEnabled = false;
    else if (legacyMute === '0') base.soundEnabled = true;

    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      if (isTableSkin(parsed.tableSkin)) base.tableSkin = parsed.tableSkin;
      if (typeof parsed.soundEnabled === 'boolean') base.soundEnabled = parsed.soundEnabled;
      base.soundVolume = clampVolume(parsed.soundVolume, base.soundVolume);
      if (typeof parsed.hapticsEnabled === 'boolean') base.hapticsEnabled = parsed.hapticsEnabled;
      if (typeof parsed.splashEnabled === 'boolean') base.splashEnabled = parsed.splashEnabled;
      if (parsed.handLayout === 'double' || parsed.handLayout === 'single') {
        base.handLayout = parsed.handLayout;
      }
      if (typeof parsed.showCardBadges === 'boolean') base.showCardBadges = parsed.showCardBadges;
      if (typeof parsed.showPointPips === 'boolean') base.showPointPips = parsed.showPointPips;
      if (typeof parsed.autoSelectMandatory === 'boolean') {
        base.autoSelectMandatory = parsed.autoSelectMandatory;
      }
      if (typeof parsed.hidePortraitBanner === 'boolean') {
        base.hidePortraitBanner = parsed.hidePortraitBanner;
      }
      if (isBotDifficulty(parsed.allyBotDifficulty)) {
        base.allyBotDifficulty = parsed.allyBotDifficulty;
      }
      if (isBotDifficulty(parsed.opponentBotDifficulty)) {
        base.opponentBotDifficulty = parsed.opponentBotDifficulty;
      }
    }
  } catch {
    // Ignore restricted storage environments
  }
  return base;
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    window.localStorage.setItem(LEGACY_SKIN_KEY, settings.tableSkin);
    window.localStorage.setItem(LEGACY_MUTE_KEY, settings.soundEnabled ? '0' : '1');
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}
