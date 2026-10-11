import type { AnnouncementType } from '@/types';

/**
 * Aturan pengumuman yang dipakai bersama oleh API route (server) dan komponen
 * banner/admin (browser) supaya validasi & penandaan kedaluwarsa tidak pernah
 * beda. File ini sengaja tidak memakai `server-only`.
 */

export const ANNOUNCEMENT_TYPES: readonly AnnouncementType[] = [
  'info',
  'warning',
  'danger',
  'success',
];

export const MAX_ANNOUNCEMENT_TITLE = 200;
export const MAX_ANNOUNCEMENT_CONTENT = 5000;

export const ANNOUNCEMENT_TYPE_LABELS: Record<AnnouncementType, string> = {
  info: 'Info',
  warning: 'Peringatan',
  danger: 'Penting',
  success: 'Sukses',
};

export function isAnnouncementType(value: unknown): value is AnnouncementType {
  return typeof value === 'string' && (ANNOUNCEMENT_TYPES as readonly string[]).includes(value);
}

/** Pengumuman dianggap tayang bila aktif DAN belum lewat `expires_at`. */
export function isAnnouncementExpired(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false;
  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) return false;
  return expiresMs <= now.getTime();
}

/** Buang pengumuman yang sudah kedaluwarsa (dipakai API publik & banner). */
export function filterLiveAnnouncements<T extends { expires_at: string | null }>(
  list: T[],
  now: Date = new Date(),
): T[] {
  return list.filter((item) => !isAnnouncementExpired(item.expires_at, now));
}

/**
 * Normalisasi `expires_at` dari request body / form.
 * Menerima null / string kosong (→ permanen), ISO string, atau format
 * `datetime-local` (`YYYY-MM-DDTHH:mm`).
 */
export function normalizeExpiresAt(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'Format tanggal kedaluwarsa tidak valid' };

  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'null') return { ok: true, value: null };

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: 'Format tanggal kedaluwarsa tidak valid' };
  }
  return { ok: true, value: parsed.toISOString() };
}
