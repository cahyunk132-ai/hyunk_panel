'use client';

import { useContext } from 'react';
import {
  AppearanceContext,
  type AppearanceContextValue,
} from '@/components/theme/appearance-context';

/**
 * Akses & ubah preferensi appearance dari komponen mana pun di dalam <ThemeProvider>.
 * Perubahan langsung diterapkan ke CSS variables di <html> (tanpa reload).
 */
export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error('useAppearance() harus dipakai di dalam <ThemeProvider>.');
  return ctx;
}
