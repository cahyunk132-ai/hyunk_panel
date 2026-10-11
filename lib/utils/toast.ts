/**
 * Toast store ringan (tanpa dependency tambahan).
 *
 * Dipakai lewat helper `toast.success(...)` / `toast.error(...)` dari komponen
 * client mana pun; yang merender adalah <Toaster /> di root layout sehingga
 * toast tetap hidup saat pindah halaman (mis. reset password → /login).
 *
 * Untuk operasi yang lama, pakai `toast.loading(...)` lalu `updateToast(id, ...)`
 * (atau `toastOperation(...)` yang membungkus Promise) agar satu toast berubah
 * dari "sedang diproses…" menjadi sukses / gagal.
 */

export type ToastTone = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const EMPTY: ToastItem[] = [];
const DEFAULT_DURATION_MS = 4500;
/** Error sengaja tampil lebih lama agar pesan kegagalan sempat terbaca. */
const ERROR_DURATION_MS = 7000;

let items: ToastItem[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  listeners.forEach((listener) => listener());
}

function clearTimer(id: number) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

/** Hapus satu toast (dipanggil tombol ✕ atau saat durasinya habis). */
export function dismissToast(id: number): void {
  clearTimer(id);
  if (items.some((item) => item.id === id)) {
    items = items.filter((item) => item.id !== id);
    emit();
  }
}

function scheduleDismiss(id: number, durationMs: number) {
  clearTimer(id);
  if (durationMs > 0) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), durationMs),
    );
  }
}

/** Tampilkan toast. Mengembalikan id toast (untuk dismiss / update manual). */
export function pushToast(message: string, tone: ToastTone = 'info', durationMs = DEFAULT_DURATION_MS): number {
  if (typeof window === 'undefined') return -1;
  const id = nextId++;
  items = [...items, { id, message, tone }];
  emit();
  scheduleDismiss(id, durationMs);
  return id;
}

/**
 * Ubah toast yang sudah ada (mis. dari "sedang diproses…" → sukses/gagal).
 * Jika id sudah hilang (user menutupnya), buat toast baru agar hasil tetap terlihat.
 */
export function updateToast(
  id: number,
  message: string,
  tone: ToastTone,
  durationMs = tone === 'loading' ? 0 : tone === 'error' ? ERROR_DURATION_MS : DEFAULT_DURATION_MS,
): number {
  if (typeof window === 'undefined') return -1;
  if (!items.some((item) => item.id === id)) {
    // Toast progres yang sudah ditutup user tidak dimunculkan lagi; hasil akhir tetap ditampilkan.
    if (tone === 'loading') return id;
    return pushToast(message, tone, durationMs);
  }
  items = items.map((item) => (item.id === id ? { ...item, message, tone } : item));
  emit();
  scheduleDismiss(id, durationMs);
  return id;
}

export const toast = {
  success: (message: string, durationMs?: number) => pushToast(message, 'success', durationMs),
  error: (message: string, durationMs = ERROR_DURATION_MS) => pushToast(message, 'error', durationMs),
  warning: (message: string, durationMs?: number) => pushToast(message, 'warning', durationMs),
  info: (message: string, durationMs?: number) => pushToast(message, 'info', durationMs),
  /** Toast "sedang diproses…" — tidak auto-hilang sampai di-update atau ditutup. */
  loading: (message: string) => pushToast(message, 'loading', 0),
};

/**
 * Jalankan operasi async sambil menampilkan toast "sedang diproses…" yang lalu
 * berubah menjadi sukses (hijau) atau gagal (merah, dengan pesan error).
 * Error tetap dilempar lagi agar pemanggil bisa memperbarui state UI-nya.
 */
export async function toastOperation<T>(
  operation: () => Promise<T>,
  messages: {
    loading: string;
    success: string | ((result: T) => string);
    error?: string | ((err: unknown) => string);
  },
): Promise<T> {
  const id = toast.loading(messages.loading);
  try {
    const result = await operation();
    const message = typeof messages.success === 'function' ? messages.success(result) : messages.success;
    updateToast(id, message, 'success');
    return result;
  } catch (err) {
    const fallback = err instanceof Error ? err.message : 'Operasi gagal';
    const message =
      typeof messages.error === 'function'
        ? messages.error(err)
        : (messages.error ?? fallback);
    updateToast(id, message, 'error');
    throw err;
  }
}

/** Subscription untuk useSyncExternalStore. */
export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot stabil: array hanya diganti saat isinya berubah. */
export function getToastsSnapshot(): ToastItem[] {
  return items;
}
