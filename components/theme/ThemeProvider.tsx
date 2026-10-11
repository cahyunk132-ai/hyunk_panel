'use client';

import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyAppearanceToRoot, normalizePrefs } from '@/lib/appearance/apply';
import {
  DEFAULT_PREFS,
  DEFAULT_THEME,
  PALETTE_IDS,
  PALETTES,
  THEME_STORAGE_KEY,
  WALLPAPER_URLS,
  type AppearancePrefs,
  type PaletteId,
  type ThemeId,
} from '@/lib/appearance/config';
import {
  clearStoredAppearance,
  readCustomImage,
  readPrefs,
  writeCustomImage,
  writePrefs,
} from '@/lib/appearance/storage';
import { AppearanceContext, type AppearanceContextValue } from './appearance-context';

function AppearanceState({ children }: { children: ReactNode }) {
  const { theme, resolvedTheme, setTheme: setNextTheme } = useTheme();
  const [prefs, setPrefsState] = useState<AppearancePrefs>(DEFAULT_PREFS);
  const [customImage, setCustomImageState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Muat preferensi dari localStorage setelah mount (aman untuk SSR/hydration).
  useEffect(() => {
    setPrefsState(readPrefs());
    setCustomImageState(readCustomImage());
    setReady(true);
  }, []);

  const paletteId: PaletteId | null =
    resolvedTheme && resolvedTheme in PALETTES ? (resolvedTheme as PaletteId) : null;

  // Terapkan ke document.documentElement setiap kali preferensi/tema berubah → real-time.
  useEffect(() => {
    if (!ready || !paletteId) return;
    applyAppearanceToRoot(
      { theme: paletteId, prefs, customImage, palettes: PALETTES, wallpapers: WALLPAPER_URLS },
      document.documentElement,
    );
    writePrefs(prefs);
  }, [ready, paletteId, prefs, customImage]);

  const setPrefs = useCallback((patch: Partial<AppearancePrefs>) => {
    setPrefsState((prev) => normalizePrefs({ ...prev, ...patch }, DEFAULT_PREFS));
  }, []);

  const setCustomImage = useCallback((dataUrl: string | null) => {
    const saved = writeCustomImage(dataUrl);
    if (saved) setCustomImageState(dataUrl);
    return saved;
  }, []);

  const setTheme = useCallback((next: ThemeId) => setNextTheme(next), [setNextTheme]);

  const resetToDefault = useCallback(() => {
    setNextTheme(DEFAULT_THEME);
    setPrefsState(DEFAULT_PREFS);
    setCustomImageState(null);
    clearStoredAppearance();
  }, [setNextTheme]);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      theme: (theme as ThemeId | undefined) ?? DEFAULT_THEME,
      resolvedTheme: paletteId,
      setTheme,
      prefs,
      setPrefs,
      customImage,
      setCustomImage,
      resetToDefault,
      ready,
    }),
    [theme, paletteId, setTheme, prefs, setPrefs, customImage, setCustomImage, resetToDefault, ready],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {/* Lapisan latar: di belakang seluruh konten, di atas canvas. Gaya diatur via --app-bg. */}
      <div aria-hidden="true" className="app-bg-layer pointer-events-none fixed inset-0 -z-10" />
      {children}
    </AppearanceContext.Provider>
  );
}

/**
 * ThemeProvider: next-themes (dark/light/system + 6 tema warna lain via atribut data-theme)
 * + state preferensi appearance. Pasang sekali di root layout.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme={DEFAULT_THEME}
      themes={[...PALETTE_IDS]}
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      <AppearanceState>{children}</AppearanceState>
    </NextThemesProvider>
  );
}
