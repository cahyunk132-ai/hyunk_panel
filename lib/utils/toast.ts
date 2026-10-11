/**
 * Toast store ringan (tanpa dependency tambahan).
 *
 * Dipakai lewat helper `toast.success(...)` / `toast.error(...)` dari komponen
 * client mana pun; yang merender adalah <Toaster /> di root layout sehingga
 * toast tetap hidup saat pindah halaman (mis. reset password → /login).
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const EMPTY: ToastItem[] = [];

let items: ToastItem[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Hapus satu toast (dipanggil tombol ✕ atau saat durasinya habis). */
export function dismissToast(id: number): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (items.some((item) => item.id === id)) {
    items = items.filter((item) => item.id !== id);
    emit();
  }
}

/** Tampilkan toast. Mengembalikan id toast (untuk dismiss manual). */
export function pushToast(message: string, tone: ToastTone = 'info', durationMs = 4500): number {
  if (typeof window === 'undefined') return -1;
  const id = nextId++;
  items = [...items, { id, message, tone }];
  emit();
  if (durationMs > 0) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), durationMs),
    );
  }
  return id;
}

export const toast = {
  success: (message: string, durationMs?: number) => pushToast(message, 'success', durationMs),
  error: (message: string, durationMs?: number) => pushToast(message, 'error', durationMs),
  warning: (message: string, durationMs?: number) => pushToast(message, 'warning', durationMs),
  info: (message: string, durationMs?: number) => pushToast(message, 'info', durationMs),
};

/** Subscription untuk useSyncExternalStore. */
export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Snapshot stabil: array hanya diganti saat isinya berubah. */
export function getToastsSnapshot(): ToastItem[] {
  return items;
}
