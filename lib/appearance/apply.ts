import type { AppearancePrefs, BackgroundMode, FontSize, Palette } from './config';

/**
 * PENTING: `normalizePrefs` dan `applyAppearanceToRoot` di-serialize (Function.toString)
 * ke inline script di <head> agar tema terpasang SEBELUM first paint (anti-flash).
 * Karena itu kedua fungsi harus self-contained:
 *  - tidak boleh mengacu ke variabel/konstanta level modul (semua data lewat argumen),
 *  - tidak boleh memakai helper eksternal (semua helper didefinisikan di dalam body).
 */

export interface ApplyInput {
  /** Palet yang sudah di-resolve (bukan 'system'). */
  theme: string;
  prefs: AppearancePrefs;
  /** Data URL gambar custom (base64), atau null. */
  customImage: string | null;
  palettes: Record<string, Palette>;
  /** id wallpaper → URL. */
  wallpapers: Record<string, string>;
}

/** Validasi & isi default untuk preferensi yang berasal dari localStorage. */
export function normalizePrefs(raw: unknown, defaults: AppearancePrefs): AppearancePrefs {
  const r: Record<string, any> = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const bg: Record<string, any> = r.background && typeof r.background === 'object' ? r.background : {};
  const glass: Record<string, any> = r.glass && typeof r.glass === 'object' ? r.glass : {};
  const modes = ['solid', 'gradient', 'preset', 'custom'];
  const sizes = ['sm', 'md', 'lg'];
  const opacity =
    typeof glass.opacity === 'number' && isFinite(glass.opacity)
      ? Math.min(0.9, Math.max(0.3, glass.opacity))
      : defaults.glass.opacity;
  const accent =
    typeof r.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.accent) ? r.accent.toLowerCase() : null;

  return {
    background: {
      mode: (modes.indexOf(bg.mode) >= 0 ? bg.mode : defaults.background.mode) as BackgroundMode,
      wallpaper: (typeof bg.wallpaper === 'string' && /^[a-z-]{1,32}$/.test(bg.wallpaper)
        ? bg.wallpaper
        : defaults.background.wallpaper) as AppearancePrefs['background']['wallpaper'],
    },
    glass: {
      enabled: typeof glass.enabled === 'boolean' ? glass.enabled : defaults.glass.enabled,
      opacity,
    },
    accent,
    fontSize: (sizes.indexOf(r.fontSize) >= 0 ? r.fontSize : defaults.fontSize) as FontSize,
    compact: typeof r.compact === 'boolean' ? r.compact : defaults.compact,
  };
}

/**
 * Menerapkan seluruh preferensi appearance ke element root (document.documentElement)
 * sebagai CSS variables + atribut data-*. Idempoten; aman dipanggil berulang.
 */
export function applyAppearanceToRoot(input: ApplyInput, root: HTMLElement): void {
  type RGB = [number, number, number];

  const palette: Palette = input.palettes[input.theme] || input.palettes.dark;
  const prefs = input.prefs;

  const toRgb = (hex: string): RGB => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const mix = (a: RGB, b: RGB, t: number): RGB => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
  // Format "r g b" supaya bisa dipakai di Tailwind: rgb(var(--x) / <alpha-value>)
  const tri = (c: RGB): string => c[0] + ' ' + c[1] + ' ' + c[2];
  const luma = (c: RGB): number => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;

  const bg = toRgb(palette.bgPrimary);
  const bg2 = toRgb(palette.bgSecondary);
  const side = toRgb(palette.bgSidebar);
  const text = toRgb(palette.textPrimary);
  const text2 = toRgb(palette.textSecondary);
  const border = toRgb(palette.border);
  const card = toRgb(palette.card);
  const accent = toRgb(prefs.accent || palette.accent);
  const black: RGB = [0, 0, 0];
  const onAccent: RGB = luma(accent) > 0.6 ? [15, 17, 23] : [255, 255, 255];

  const vars: Record<string, string> = {
    '--bg-primary': tri(bg),
    '--bg-secondary': tri(bg2),
    '--bg-sidebar': tri(side),
    '--text-primary': tri(text),
    '--text-secondary': tri(text2),
    '--accent': tri(accent),
    '--border': tri(border),
    '--card': tri(card),
    // Turunan (dihitung dari 8 warna dasar di atas)
    '--bg-tertiary': tri(mix(bg, text, 0.07)),
    '--bg-quaternary': tri(mix(bg, text, 0.11)),
    '--border-soft': tri(mix(bg, border, 0.5)),
    '--text-faint': tri(mix(text2, bg, 0.4)),
    '--text-soft': tri(mix(text2, bg, 0.2)),
    '--accent-dim': tri(mix(accent, black, 0.2)),
    '--on-accent': tri(onAccent),
    '--glass-alpha': String(prefs.glass.opacity),
    '--glass-blur': '14px',
  };

  // ── Latar belakang ──
  const solid = 'rgb(' + tri(bg) + ')';
  const overlay = 'linear-gradient(rgb(' + tri(bg) + ' / 0.45), rgb(' + tri(bg) + ' / 0.45))';
  const wallpaperUrl = input.wallpapers[prefs.background.wallpaper];
  let layer = solid;
  let bgMode: string = 'solid';
  if (prefs.background.mode === 'gradient') {
    bgMode = 'gradient';
    layer =
      'linear-gradient(135deg, rgb(' + tri(bg) + ') 0%, rgb(' + tri(bg2) + ') 38%, rgb(' +
      tri(accent) + ' / 0.32) 70%, rgb(' + tri(side) + ') 100%)';
  } else if (prefs.background.mode === 'preset' && wallpaperUrl) {
    bgMode = 'preset';
    layer = overlay + ', url("' + wallpaperUrl + '") center / cover no-repeat';
  } else if (prefs.background.mode === 'custom' && input.customImage) {
    bgMode = 'custom';
    layer = overlay + ', url("' + input.customImage + '") center / cover no-repeat';
  }

  const style = root.style;
  Object.keys(vars).forEach((name) => style.setProperty(name, vars[name]));
  style.setProperty('--app-bg', layer);
  style.setProperty('color-scheme', palette.mode);
  const fontPx: Record<string, string> = { sm: '14px', md: '16px', lg: '18px' };
  style.fontSize = fontPx[prefs.fontSize] || '16px';

  root.setAttribute('data-theme', input.theme);
  root.setAttribute('data-bg-mode', bgMode);
  root.setAttribute('data-glass', prefs.glass.enabled ? 'on' : 'off');
  root.setAttribute('data-compact', prefs.compact ? 'on' : 'off');
}
