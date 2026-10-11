'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AppearanceControls } from './AppearanceControls';

function PaletteIcon() {
  return (
    <svg
      className="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 1 0 0 18c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.7-.4-1-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8Z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
      <circle cx="10.5" cy="7" r="1" fill="currentColor" />
      <circle cx="15" cy="7.5" r="1" fill="currentColor" />
      <circle cx="17.5" cy="11" r="1" fill="currentColor" />
    </svg>
  );
}

/** Tombol 🎨 di topbar (pojok kanan) yang membuka drawer appearance. */
export function AppearanceButton() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buka pengaturan appearance"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Appearance"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-base-800 hover:text-ink"
      >
        <PaletteIcon />
      </button>
      {mounted && open && createPortal(<AppearanceDrawer onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/** Drawer kanan: kontrol appearance lengkap tanpa perlu pindah halaman. */
export function AppearanceDrawer({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        aria-label="Tutup appearance"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Appearance"
        className="fade-in-up relative flex h-full w-full max-w-sm flex-col border-l border-line bg-base-950/95 shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Appearance</h2>
            <p className="mt-0.5 text-xs text-ink-muted">Perubahan langsung diterapkan.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-md p-1 text-ink-muted transition-colors hover:bg-base-700 hover:text-ink"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <AppearanceControls inDrawer />
        </div>

        <div className="shrink-0 border-t border-line-soft px-5 py-3">
          <Link
            href="/settings/appearance"
            onClick={onClose}
            className="flex items-center justify-center gap-2 rounded-lg border border-line bg-base-800 px-4 py-2 text-sm text-ink-muted transition-colors hover:border-accent/40 hover:text-accent"
          >
            Buka halaman lengkap
            <span aria-hidden>→</span>
          </Link>
        </div>
      </aside>
    </div>
  );
}
