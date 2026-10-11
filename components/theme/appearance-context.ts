import { createContext } from 'react';
import type { AppearancePrefs, PaletteId, ThemeId } from '@/lib/appearance/config';

export interface AppearanceContextValue {
  /** Pilihan tema user (bisa 'system'). */
  theme: ThemeId;
  /** Palet yang sedang aktif setelah 'system' di-resolve; null sebelum mount. */
  resolvedTheme: PaletteId | null;
  setTheme: (theme: ThemeId) => void;
  prefs: AppearancePrefs;
  /** Update sebagian preferensi (nested object harus dikirim utuh). */
  setPrefs: (patch: Partial<AppearancePrefs>) => void;
  /** Data URL gambar custom, atau null. */
  customImage: string | null;
  /** Simpan gambar custom. Mengembalikan false bila localStorage menolak (kuota). */
  setCustomImage: (dataUrl: string | null) => boolean;
  /** Kembalikan semua appearance ke default (termasuk gambar custom). */
  resetToDefault: () => void;
  /** true setelah preferensi dari localStorage selesai dimuat. */
  ready: boolean;
}

export const AppearanceContext = createContext<AppearanceContextValue | null>(null);
