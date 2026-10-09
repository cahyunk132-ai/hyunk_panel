import 'server-only';
import type { BackupInterval } from '@/types';

/**
 * Hitung next_run_at berikutnya untuk sebuah jadwal backup.
 *
 * - hourly → batas jam berikutnya (menit 0, detik 0); time_of_day diabaikan.
 * - daily  → jam time_of_day hari ini bila masih di depan, jika tidak → besok.
 * - weekly → hari day_of_week (0 = Minggu) jam time_of_day minggu ini bila
 *   masih di depan, jika tidak → minggu depan.
 *
 * Semua perhitungan memakai waktu server (UTC).
 */
export function computeNextRunAt(
  interval: BackupInterval,
  timeOfDay: string | null | undefined,
  dayOfWeek: number | null | undefined,
  from: Date = new Date(),
): Date {
  const base = new Date(from.getTime());

  if (interval === 'hourly') {
    const next = new Date(base);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next;
  }

  // daily / weekly memakai time_of_day (default 03:00)
  const [hh = 3, mm = 0] = (timeOfDay ?? '03:00').split(':').map((v) => parseInt(v, 10) || 0);

  if (interval === 'daily') {
    const candidate = new Date(base);
    candidate.setHours(hh, mm, 0, 0);
    if (candidate.getTime() <= base.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  // weekly — dayOfWeek: 0 = Minggu … 6 = Sabtu (versi JS getDay()).
  const targetDay = dayOfWeek === null || dayOfWeek === undefined ? 0 : ((dayOfWeek % 7) + 7) % 7;
  const candidate = new Date(base);
  candidate.setHours(hh, mm, 0, 0);
  const diff = (targetDay - candidate.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + diff);
  if (candidate.getTime() <= base.getTime()) {
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate;
}

/** Validasi format time_of_day "HH:MM" (00:00–23:59). */
export function isValidTimeOfDay(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Validasi day_of_week 0–6. */
export function isValidDayOfWeek(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 6;
}

/** Validasi retention 1–20. */
export function isValidRetention(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 20;
}
