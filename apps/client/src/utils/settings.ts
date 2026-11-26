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
export type RightClickMode = 'clear' | 'play';

export const MIN_CARD_SCALE = 0.85;
export const MAX_CARD_SCALE = 1.3;
export const CARD_SCALE_STEP = 0.05;

export function clampCardScale(value: unknown, fallback = 1.0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(MAX_CARD_SCALE, Math.max(MIN_CARD_SCALE, value));
  return Math.round(clamped * 20) / 20;
}
export type BotDifficulty = 'low' | 'medium' | 'high';
export type DealSpeed = 1 | 2 | 3 | 4 | 5;
export type BgmTrackId = 'jiangnan' | 'haipai' | 'guqin';

export const BOT_DIFFICULTY_OPTIONS: readonly {
  id: BotDifficulty;
  label: string;
  desc: string;
}[] = [
  { id: 'low', label: '低', desc: '轻松入门' },
  { id: 'medium', label: '中', desc: '休闲实战' },
  { id: 'high', label: '强', desc: '高智商搜索' },
];

export const DEAL_SPEED_OPTIONS: readonly {
  id: DealSpeed;
  label: string;
  ms: number;
  desc: string;
}[] = [
  { id: 1, label: '慢', ms: 960, desc: '约 36 秒发完 · 从容看牌' },
  { id: 2, label: '较慢', ms: 760, desc: '约 29 秒发完 · 轻松亮主' },
  { id: 3, label: '适中', ms: 600, desc: '约 23 秒发完 · 节奏均衡' },
  { id: 4, label: '较快', ms: 460, desc: '约 17 秒发完 · 明快紧凑' },
  { id: 5, label: '极速', ms: 340, desc: '约 13 秒发完 · 原速最快' },
];

export const BGM_TRACK_OPTIONS: readonly {
  id: BgmTrackId;
  label: string;
  subtitle: string;
  desc: string;
}[] = [
  {
    id: 'jiangnan',
    label: '江南丝竹',
    subtitle: '古筝 · 洞箫',
    desc: '五声清雅丝竹，金山水乡茶室韵味',
  },
  {
    id: 'haipai',
    label: '海派雅韵',
    subtitle: '暖音电钢 · 拨弦',
    desc: '老上海慢爵士茶馆氛围，久听舒缓不腻',
  },
  {
    id: 'guqin',
    label: '幽兰清茶',
    subtitle: '古琴 · 泛音',
    desc: '留白极简禅意琴音，适合静心算牌',
  },
];

export interface AppSettings {
  tableSkin: TableSkin;
  soundEnabled: boolean;
  soundVolume: number; // 0..100
  bgmEnabled: boolean;
  bgmTrack: BgmTrackId;
  bgmVolume: number; // 0..100
  hapticsEnabled: boolean;
  splashEnabled: boolean;
  handLayout: HandLayoutMode;
  showCardBadges: boolean;
  showPointPips: boolean;
  autoSelectMandatory: boolean;
  hidePortraitBanner: boolean;
  dealSpeed: DealSpeed;
  allyBotDifficulty: BotDifficulty;
  opponentBotDifficulty: BotDifficulty;
  rightClickMode: RightClickMode;
  doubleClickPlay: boolean;
  cardScale: number; // 0.85..1.30
  flashTaskbarOnTurn: boolean;
  confirmExitInGame: boolean;
}

const SETTINGS_KEY = 'jinshan.settings.v1';
const LEGACY_SKIN_KEY = 'jinshan.tableSkin';
const LEGACY_MUTE_KEY = 'jinshan_sound_muted';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  tableSkin: 'ink',
  soundEnabled: true,
  soundVolume: 82,
  bgmEnabled: true,
  bgmTrack: 'jiangnan',
  bgmVolume: 45,
  hapticsEnabled: true,
  splashEnabled: true,
  handLayout: 'double',
  showCardBadges: true,
  showPointPips: true,
  autoSelectMandatory: true,
  hidePortraitBanner: false,
  dealSpeed: 5,
  allyBotDifficulty: 'high',
  opponentBotDifficulty: 'high',
  rightClickMode: 'clear',
  doubleClickPlay: true,
  cardScale: 1.0,
  flashTaskbarOnTurn: true,
  confirmExitInGame: true,
};

export function isTableSkin(value: unknown): value is TableSkin {
  return TABLE_SKIN_OPTIONS.some((s) => s.id === value);
}

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return value === 'low' || value === 'medium' || value === 'high';
}

export function isDealSpeed(value: unknown): value is DealSpeed {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function isBgmTrackId(value: unknown): value is BgmTrackId {
  return BGM_TRACK_OPTIONS.some((t) => t.id === value);
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
      if (typeof parsed.bgmEnabled === 'boolean') base.bgmEnabled = parsed.bgmEnabled;
      if (isBgmTrackId(parsed.bgmTrack)) base.bgmTrack = parsed.bgmTrack;
      base.bgmVolume = clampVolume(parsed.bgmVolume, base.bgmVolume);
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
      if (isDealSpeed(parsed.dealSpeed)) {
        base.dealSpeed = parsed.dealSpeed;
      }
      if (isBotDifficulty(parsed.allyBotDifficulty)) {
        base.allyBotDifficulty = parsed.allyBotDifficulty;
      }
      if (isBotDifficulty(parsed.opponentBotDifficulty)) {
        base.opponentBotDifficulty = parsed.opponentBotDifficulty;
      }
      if (parsed.rightClickMode === 'clear' || parsed.rightClickMode === 'play') {
        base.rightClickMode = parsed.rightClickMode;
      }
      if (typeof parsed.doubleClickPlay === 'boolean') {
        base.doubleClickPlay = parsed.doubleClickPlay;
      }
      base.cardScale = clampCardScale(parsed.cardScale, base.cardScale);
      if (typeof parsed.flashTaskbarOnTurn === 'boolean') {
        base.flashTaskbarOnTurn = parsed.flashTaskbarOnTurn;
      }
      if (typeof parsed.confirmExitInGame === 'boolean') {
        base.confirmExitInGame = parsed.confirmExitInGame;
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
