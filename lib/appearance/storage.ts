import {
  CUSTOM_BG_STORAGE_KEY,
  DEFAULT_PREFS,
  PREFS_STORAGE_KEY,
  type AppearancePrefs,
} from './config';
import { normalizePrefs } from './apply';

// Semua akses localStorage dibungkus try/catch: mode privat/terblokir tidak boleh
// membuat panel crash — cukup pakai default.

export function readPrefs(): AppearancePrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    return normalizePrefs(raw ? JSON.parse(raw) : null, DEFAULT_PREFS);
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(prefs: AppearancePrefs): void {
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode — abaikan, preferensi tetap berlaku untuk sesi ini */
  }
}

export function readCustomImage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(CUSTOM_BG_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Mengembalikan false bila penyimpanan gagal (mis. kuota localStorage penuh). */
export function writeCustomImage(dataUrl: string | null): boolean {
  try {
    if (dataUrl === null) window.localStorage.removeItem(CUSTOM_BG_STORAGE_KEY);
    else window.localStorage.setItem(CUSTOM_BG_STORAGE_KEY, dataUrl);
    return true;
  } catch {
    return false;
  }
}

export function clearStoredAppearance(): void {
  try {
    window.localStorage.removeItem(PREFS_STORAGE_KEY);
    window.localStorage.removeItem(CUSTOM_BG_STORAGE_KEY);
  } catch {
    /* abaikan */
  }
}
