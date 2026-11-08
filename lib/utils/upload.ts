/**
 * Upload multipart dengan progres persentase.
 *
 * `fetch` belum mendukung event progres upload, jadi memakai XMLHttpRequest.
 * Mengembalikan status HTTP + body respons (teks) supaya caller bisa
 * menampilkan pesan asli dari Wings (mis. "larger than the maximum file
 * upload size") alih-alih pesan generik.
 *
 * Error yang dilempar adalah {@link UploadError} dengan `kind`:
 *  - `network`  → request tidak pernah mendapat respons. Penyebab paling
 *                 umum: diblokir CSP `connect-src`, diblokir CORS Wings,
 *                 node mati / port tertutup, atau TLS ditolak.
 *  - `timeout`  → koneksi diam terlalu lama (stall) lalu di-abort.
 *  - `aborted`  → dibatalkan pemanggil.
 */

export type UploadErrorKind = 'network' | 'timeout' | 'aborted';

export class UploadError extends Error {
  readonly kind: UploadErrorKind;

  constructor(kind: UploadErrorKind, message: string) {
    super(message);
    this.name = 'UploadError';
    this.kind = kind;
  }
}

export interface UploadResult {
  ok: boolean;
  status: number;
  /** Body respons (dipotong) — Wings mengirim `{ "error": "..." }` saat gagal. */
  text: string;
}

export interface UploadOptions {
  method?: 'POST' | 'PUT';
  /** Dipanggil tiap ada progres upload (0-100). */
  onProgress?: (percent: number) => void;
  /**
   * Batas waktu tanpa progres sama sekali sebelum upload dianggap mati.
   * Default 120 detik (cukup untuk koneksi lambat, tidak menggantung selamanya).
   */
  stallTimeoutMs?: number;
  /**
   * Batas waktu menunggu respons setelah seluruh byte terkirim (Wings menulis
   * file ke disk dulu). Default 5 menit.
   */
  responseTimeoutMs?: number;
}

const DEFAULT_STALL_TIMEOUT_MS = 120_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 300_000;
const MAX_ERROR_TEXT = 600;

export function uploadWithProgress(
  url: string,
  body: FormData | Blob,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const { method = 'POST', onProgress, stallTimeoutMs, responseTimeoutMs } = options;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function clearTimer() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function finish() {
      settled = true;
      clearTimer();
    }

    function armTimer(ms: number) {
      clearTimer();
      if (ms <= 0) return;
      timer = setTimeout(() => {
        timer = null;
        if (settled) return;
        finish();
        xhr.abort();
        reject(
          new UploadError(
            'timeout',
            'Upload berhenti merespons (koneksi ke node terlalu lambat atau terputus).',
          ),
        );
      }, ms);
    }

    try {
      xhr.open(method, url);
    } catch {
      reject(new UploadError('network', 'URL upload tidak valid.'));
      return;
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
      armTimer(stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS);
    };

    // Semua byte sudah terkirim: Wings masih memproses (menulis ke disk),
    // jadi beri waktu lebih panjang untuk menunggu respons.
    xhr.upload.onload = () => {
      onProgress?.(100);
      armTimer(responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS);
    };

    xhr.onload = () => {
      if (settled) return;
      finish();
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        text: (xhr.responseText ?? '').slice(0, MAX_ERROR_TEXT),
      });
    };

    xhr.onerror = () => {
      if (settled) return;
      finish();
      reject(
        new UploadError(
          'network',
          'Koneksi ke node terputus saat upload (request diblokir jaringan, CSP, atau CORS node).',
        ),
      );
    };

    xhr.onabort = () => {
      if (settled) return;
      finish();
      reject(new UploadError('aborted', 'Upload dibatalkan'));
    };

    armTimer(stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS);
    xhr.send(body);
  });
}

/** Ambil pesan error dari body respons Wings/panel (`{ "error": "..." }` atau teks bebas). */
export function uploadErrorMessage(result: UploadResult, fallback: string): string {
  const text = result.text?.trim();
  if (!text) return fallback;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      for (const key of ['error', 'message', 'detail']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
  } catch {
    // body bukan JSON — pakai teks mentah
  }
  return text;
}

/**
 * Pesan troubleshooting saat browser sama sekali tidak bisa menjangkau node.
 * Sembilan dari sepuluh kasus: CSP panel belum mengizinkan host node, atau
 * Wings tidak mengirim header CORS untuk origin panel.
 */
export function nodeUnreachableHint(nodeHost?: string | null): string {
  const host = nodeHost ? ` (${nodeHost})` : '';
  return [
    `Browser tidak bisa menjangkau node${host} secara langsung.`,
    'Periksa: (1) host node terdaftar di NEXT_PUBLIC_WINGS_ORIGINS / subdomain NEXT_PUBLIC_BASE_DOMAIN lalu redeploy panel,',
    '(2) Wings mengirim CORS untuk origin panel — tambahkan https://panel... ke `api.allowed_origins` di /etc/pterodactyl/config.yml,',
    '(3) port Wings (default 8080) terbuka dari internet dan sertifikat TLS-nya valid.',
  ].join(' ');
}
