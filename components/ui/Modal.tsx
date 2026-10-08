'use client';

import { useEffect, type ReactNode } from 'react';

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* max-h + flex-col: header tetap terlihat, body yang di-scroll (bukan terpotong viewport). */}
      <div
        className={`fade-in-up my-auto flex max-h-[90vh] w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} flex-col rounded-xl border border-line bg-base-850 shadow-glow`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line-soft px-5 py-4">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-ink-muted transition-colors hover:bg-base-700 hover:text-ink"
            aria-label="Tutup"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Dialog konfirmasi ganda: user harus mengetik kalimat/nama untuk konfirmasi. */
export function ConfirmDangerModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  typedValue,
  setTypedValue,
  loading,
  dangerLabel = 'Hapus',
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmText: string;
  typedValue: string;
  setTypedValue: (v: string) => void;
  loading?: boolean;
  dangerLabel?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {description}
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-ink-muted">
            Ketik <code className="rounded bg-base-600 px-1.5 py-0.5 font-mono text-[11px] text-red-300">{confirmText}</code> untuk melanjutkan
          </label>
          <input
            value={typedValue}
            onChange={(e) => setTypedValue(e.target.value)}
            className="w-full rounded-lg border border-line bg-base-900 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-accent/50"
            placeholder={confirmText}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <button
            onClick={onClose}
            className="w-full rounded-lg border border-line bg-base-600 px-4 py-2 text-sm text-ink-muted hover:text-ink md:w-auto"
          >
            Batal
          </button>
          <button
            onClick={onConfirm}
            disabled={typedValue !== confirmText || loading}
            className="w-full rounded-lg bg-red-500/80 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-40 md:w-auto"
          >
            {loading ? 'Memproses…' : dangerLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
