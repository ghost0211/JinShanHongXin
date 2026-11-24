export const TABLE_SKIN_OPTIONS = [
  {
    id: 'classic',
    label: '经典翡翠',
    desc: '传统丝绒翠绿牌桌',
    swatch: 'linear-gradient(135deg, #2b8a64 0%, #0d3a2a 100%)',
    accent: '#f4c96b',
  },
  {
    id: 'night-blue',
    label: '海派夜蓝',
    desc: '静谧星夜鎏银质感',
    swatch: 'linear-gradient(135deg, #3c8cc2 0%, #10243f 100%)',
    accent: '#91def4',
  },
  {
    id: 'cinnabar',
    label: '朱砂金',
    desc: '东方漆器朱砂描金',
    swatch: 'linear-gradient(135deg, #b83d3b 0%, #3d1620 100%)',
    accent: '#f0c57a',
  },
] as const;

export type TableSkin = (typeof TABLE_SKIN_OPTIONS)[number]['id'];
export type HandLayoutMode = 'double' | 'single';

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
}

const SETTINGS_KEY = 'jinshan.settings.v1';
const LEGACY_SKIN_KEY = 'jinshan.tableSkin';
const LEGACY_MUTE_KEY = 'jinshan_sound_muted';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  tableSkin: 'classic',
  soundEnabled: true,
  soundVolume: 82,
  hapticsEnabled: true,
  splashEnabled: true,
  handLayout: 'double',
  showCardBadges: true,
  showPointPips: true,
  autoSelectMandatory: true,
  hidePortraitBanner: false,
};

export function isTableSkin(value: unknown): value is TableSkin {
  return TABLE_SKIN_OPTIONS.some((s) => s.id === value);
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
