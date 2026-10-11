// ─── Konfigurasi Theme & Appearance Hyunk Panel ─────────────────────────────
// Sumber tunggal untuk daftar tema, palet warna, wallpaper, dan default preferensi.
// File ini TIDAK boleh mengimpor modul berat/side-effect: dipakai juga oleh layout
// server (inline init script anti-flash).

export const THEME_STORAGE_KEY = 'hyunk-theme';
export const PREFS_STORAGE_KEY = 'hyunk-appearance';
export const CUSTOM_BG_STORAGE_KEY = 'hyunk-appearance-bg';

export type PaletteId =
  | 'dark'
  | 'light'
  | 'ocean'
  | 'forest'
  | 'sakura'
  | 'ember'
  | 'midnight'
  | 'slate';

/** 'system' = ikut preferensi OS (dark/light) — memakai palet dark atau light. */
export type ThemeId = PaletteId | 'system';

export const DEFAULT_THEME: ThemeId = 'dark';

export interface Palette {
  label: string;
  emoji: string;
  description: string;
  /** Mode warna dasar — dipakai untuk color-scheme & kontras. */
  mode: 'dark' | 'light';
  bgPrimary: string;
  bgSecondary: string;
  bgSidebar: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  border: string;
  card: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  dark: {
    label: 'Dark',
    emoji: '🌑',
    description: 'Default panel',
    mode: 'dark',
    bgPrimary: '#0f1117',
    bgSecondary: '#171b26',
    bgSidebar: '#0c0e13',
    textPrimary: '#e6eaf2',
    textSecondary: '#9aa4b8',
    accent: '#3ecfcf',
    border: '#232a3a',
    card: '#13161f',
  },
  light: {
    label: 'Light',
    emoji: '☀️',
    description: 'Terang & bersih',
    mode: 'light',
    bgPrimary: '#f4f6fb',
    bgSecondary: '#e9edf5',
    bgSidebar: '#ffffff',
    textPrimary: '#18202f',
    textSecondary: '#5b6578',
    accent: '#0d9488',
    border: '#d8dee9',
    card: '#ffffff',
  },
  ocean: {
    label: 'Ocean',
    emoji: '🌊',
    description: 'Biru gelap',
    mode: 'dark',
    bgPrimary: '#0a1a2f',
    bgSecondary: '#0f2540',
    bgSidebar: '#071323',
    textPrimary: '#e3f1ff',
    textSecondary: '#8fb3d9',
    accent: '#38bdf8',
    border: '#1d3553',
    card: '#0d2038',
  },
  forest: {
    label: 'Forest',
    emoji: '🌲',
    description: 'Hijau gelap',
    mode: 'dark',
    bgPrimary: '#0b1f17',
    bgSecondary: '#112b21',
    bgSidebar: '#08170f',
    textPrimary: '#e4f5ea',
    textSecondary: '#9cc5ab',
    accent: '#34d399',
    border: '#1f3f31',
    card: '#0e261c',
  },
  sakura: {
    label: 'Sakura',
    emoji: '🌸',
    description: 'Pink soft',
    mode: 'light',
    bgPrimary: '#fdf4f7',
    bgSecondary: '#fbe6ee',
    bgSidebar: '#fff8fb',
    textPrimary: '#4a2638',
    textSecondary: '#8f5f75',
    accent: '#e0559a',
    border: '#f0cfdc',
    card: '#ffffff',
  },
  ember: {
    label: 'Ember',
    emoji: '🔥',
    description: 'Oranye/merah gelap',
    mode: 'dark',
    bgPrimary: '#1a0c0a',
    bgSecondary: '#241210',
    bgSidebar: '#120706',
    textPrimary: '#fde9e1',
    textSecondary: '#d6a090',
    accent: '#ff7a33',
    border: '#3b1d17',
    card: '#200f0c',
  },
  midnight: {
    label: 'Midnight Purple',
    emoji: '💜',
    description: 'Ungu tengah malam',
    mode: 'dark',
    bgPrimary: '#120c1f',
    bgSecondary: '#1a1230',
    bgSidebar: '#0c0716',
    textPrimary: '#ece6fa',
    textSecondary: '#aa9cc9',
    accent: '#a78bfa',
    border: '#2d2148',
    card: '#171029',
  },
  slate: {
    label: 'Slate',
    emoji: '🩶',
    description: 'Abu-abu modern',
    mode: 'dark',
    bgPrimary: '#1e2227',
    bgSecondary: '#272c33',
    bgSidebar: '#181c21',
    textPrimary: '#e8ebf0',
    textSecondary: '#9ba3af',
    accent: '#93c5fd',
    border: '#343b45',
    card: '#22272e',
  },
};

export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];

export const THEME_CHOICES: { id: ThemeId; label: string; emoji: string; description: string }[] = [
  ...PALETTE_IDS.map((id) => ({
    id,
    label: PALETTES[id].label,
    emoji: PALETTES[id].emoji,
    description: PALETTES[id].description,
  })),
  { id: 'system', label: 'System', emoji: '🖥️', description: 'Ikut OS (dark/light)' },
];

// ─── Wallpaper bawaan (6 gambar, disimpan di /public/wallpapers) ────────────
export const WALLPAPERS = [
  { id: 'galaxy', label: 'Galaxy', src: '/wallpapers/galaxy.jpg' },
  { id: 'forest', label: 'Forest', src: '/wallpapers/forest.jpg' },
  { id: 'ocean', label: 'Ocean', src: '/wallpapers/ocean.jpg' },
  { id: 'mountain', label: 'Mountain', src: '/wallpapers/mountain.jpg' },
  { id: 'city-night', label: 'City Night', src: '/wallpapers/city-night.jpg' },
  { id: 'abstract', label: 'Abstract', src: '/wallpapers/abstract.jpg' },
] as const;

export type WallpaperId = (typeof WALLPAPERS)[number]['id'];

export const WALLPAPER_URLS: Record<string, string> = Object.fromEntries(
  WALLPAPERS.map((wallpaper) => [wallpaper.id, wallpaper.src]),
);

// ─── Preferensi lain ────────────────────────────────────────────────────────
export type BackgroundMode = 'solid' | 'gradient' | 'preset' | 'custom';
export type FontSize = 'sm' | 'md' | 'lg';

export const FONT_SIZE_OPTIONS: { id: FontSize; label: string; px: number }[] = [
  { id: 'sm', label: 'Small', px: 14 },
  { id: 'md', label: 'Medium', px: 16 },
  { id: 'lg', label: 'Large', px: 18 },
];

export const ACCENT_PRESETS: { label: string; hex: string }[] = [
  { label: 'Biru', hex: '#3b82f6' },
  { label: 'Ungu', hex: '#8b5cf6' },
  { label: 'Hijau', hex: '#22c55e' },
  { label: 'Merah', hex: '#ef4444' },
  { label: 'Oranye', hex: '#f97316' },
  { label: 'Pink', hex: '#ec4899' },
  { label: 'Kuning', hex: '#facc15' },
  { label: 'Putih', hex: '#f8fafc' },
];

export const GLASS_MIN_OPACITY = 0.3;
export const GLASS_MAX_OPACITY = 0.9;

export interface AppearancePrefs {
  background: {
    mode: BackgroundMode;
    wallpaper: WallpaperId;
  };
  glass: {
    enabled: boolean;
    /** Opacity permukaan glass, 0.3–0.9. */
    opacity: number;
  };
  /** Hex accent custom; null = ikuti accent bawaan tema aktif. */
  accent: string | null;
  fontSize: FontSize;
  compact: boolean;
}

export const DEFAULT_PREFS: AppearancePrefs = {
  background: { mode: 'solid', wallpaper: 'galaxy' },
  glass: { enabled: false, opacity: 0.6 },
  accent: null,
  fontSize: 'md',
  compact: false,
};
