'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { isAnnouncementExpired } from '@/lib/announcements';
import { formatDateTime, formatRelativeTime } from '@/lib/utils/format';
import type { AnnouncementType, PublicAnnouncement, PublicAnnouncementsResponse } from '@/types';

/**
 * Halaman yang menampilkan banner pengumuman (tepat di bawah navbar).
 * Tambah path di sini bila pengumuman perlu muncul di halaman lain.
 */
export const ANNOUNCEMENT_BANNER_PATHS: readonly string[] = ['/dashboard', '/servers'];

/** Kunci localStorage berisi daftar ID pengumuman yang sudah ditutup user. */
const DISMISSED_STORAGE_KEY = 'hyunk.announcements.dismissed';

/** Seberapa sering banner disegarkan (sekalian mengecek yang baru kedaluwarsa). */
const REFRESH_INTERVAL_MS = 60_000;

/** Maksimal ID dismiss yang disimpan (biar localStorage tidak membengkak). */
const MAX_DISMISSED_IDS = 200;

const typeStyles: Record<AnnouncementType, { wrapper: string; accent: string }> = {
  info: { wrapper: 'border-sky-500/30 bg-sky-500/10', accent: 'text-sky-300' },
  warning: { wrapper: 'border-amber-500/30 bg-amber-500/10', accent: 'text-amber-300' },
  danger: { wrapper: 'border-red-500/30 bg-red-500/10', accent: 'text-red-300' },
  success: { wrapper: 'border-emerald-500/30 bg-emerald-500/10', accent: 'text-emerald-300' },
};

const iconProps = {
  className: 'h-5 w-5',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Ikon per tipe pengumuman. */
function TypeIcon({ type }: { type: AnnouncementType }) {
  switch (type) {
    case 'warning':
      return (
        <svg {...iconProps}>
          <path d="M10.3 4.3 2.6 17.5A1.6 1.6 0 0 0 4 20h16a1.6 1.6 0 0 0 1.4-2.5L13.7 4.3a1.6 1.6 0 0 0-3.4 0Z" />
          <path d="M12 9.5v4M12 17h.01" />
        </svg>
      );
    case 'danger':
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v6M12 16.8h.01" />
        </svg>
      );
    case 'success':
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.3 2.4 2.4 4.6-5" />
        </svg>
      );
    default:
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </svg>
      );
  }
}

function readDismissedIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeDismissedIds(ids: string[]) {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(ids.slice(-MAX_DISMISSED_IDS)));
  } catch {
    // mode privat / kuota penuh — dismiss tetap berlaku untuk sesi ini saja
  }
}

/**
 * Banner pengumuman aktif dari GET /api/announcements.
 * - beberapa pengumuman → ditumpuk vertikal
 * - warna mengikuti tipe (info biru, warning kuning, danger merah, success hijau)
 * - tombol ✕ menutup banner & menyimpan ID-nya di localStorage
 * - hilang sendiri begitu `expires_at` lewat (dicek tiap menit + disaring server)
 */
export function AnnouncementBanners() {
  const pathname = usePathname();
  const [items, setItems] = useState<PublicAnnouncement[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [now, setNow] = useState(() => new Date());

  const enabled = ANNOUNCEMENT_BANNER_PATHS.includes(pathname);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/announcements', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as PublicAnnouncementsResponse;
      setItems(Array.isArray(data.announcements) ? data.announcements : []);
    } catch {
      // Banner bukan fitur kritis: gagal memuat tidak boleh mengganggu halaman.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setDismissed(readDismissedIds());
    void load();
    const timer = setInterval(() => {
      setNow(new Date());
      void load();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, load]);

  const dismiss = useCallback((id: string) => {
    setDismissed((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      writeDismissedIds(next);
      return next;
    });
  }, []);

  if (!enabled) return null;

  const visible = items.filter(
    (item) => !dismissed.includes(item.id) && !isAnnouncementExpired(item.expires_at, now),
  );
  if (visible.length === 0) return null;

  return (
    <div className="mb-5 space-y-2.5" aria-live="polite">
      {visible.map((item) => {
        const style = typeStyles[item.type] ?? typeStyles.info;
        return (
          <div
            key={item.id}
            className={`fade-in-up flex items-start gap-3 rounded-xl border px-4 py-3 ${style.wrapper}`}
          >
            <span className={`mt-0.5 shrink-0 ${style.accent}`} aria-hidden="true">
              <TypeIcon type={item.type} />
            </span>

            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${style.accent}`}>{item.title}</p>
              <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-ink-muted">
                {item.content}
              </p>
              <p className="mt-1.5 text-[10px] text-ink-faint">
                {formatRelativeTime(item.created_at)}
                {item.expires_at ? ` · berlaku hingga ${formatDateTime(item.expires_at)}` : ''}
              </p>
            </div>

            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="-mr-1 shrink-0 rounded-md p-1 text-ink-faint transition-colors hover:bg-black/20 hover:text-ink"
              aria-label={`Tutup pengumuman ${item.title}`}
              title="Tutup"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
