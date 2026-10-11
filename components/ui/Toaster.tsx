'use client';

import { useSyncExternalStore } from 'react';
import {
  dismissToast,
  getToastsSnapshot,
  subscribeToasts,
  type ToastTone,
} from '@/lib/utils/toast';

const toneClasses: Record<ToastTone, string> = {
  success: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300',
  error: 'border-red-500/35 bg-red-500/10 text-red-300',
  warning: 'border-amber-500/35 bg-amber-500/10 text-amber-300',
  info: 'border-sky-500/35 bg-sky-500/10 text-sky-300',
};

const iconPath: Record<ToastTone, string> = {
  success: 'm5 13 4 4L19 7',
  error: 'M18 6 6 18M6 6l12 12',
  warning: 'M12 9v4M12 17h.01M10.3 4.3 2.6 17.5A1.6 1.6 0 0 0 4 20h16a1.6 1.6 0 0 0 1.4-2.5L13.7 4.3a1.6 1.6 0 0 0-3.4 0Z',
  info: 'M12 11v5M12 8h.01',
};

/**
 * Renderer toast global — dipasang sekali di app/layout.tsx.
 * Muncul di pojok kanan bawah, auto-hilang, bisa ditutup manual.
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToastsSnapshot, getToastsSnapshot);
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className={`fade-in-up pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs shadow-glow backdrop-blur ${toneClasses[item.tone]}`}
        >
          <svg
            className="mt-px h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={iconPath[item.tone]} />
          </svg>
          <p className="min-w-0 flex-1 leading-relaxed text-ink">{item.message}</p>
          <button
            type="button"
            onClick={() => dismissToast(item.id)}
            className="-mr-1 shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:text-ink"
            aria-label="Tutup notifikasi"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
