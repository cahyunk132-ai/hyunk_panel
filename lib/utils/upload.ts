/**
 * Upload multipart dengan progres persentase.
 *
 * `fetch` belum mendukung event progres upload, jadi memakai XMLHttpRequest.
 * Mengembalikan status HTTP; caller yang memutuskan apakah status itu sukses.
 */
export function uploadWithProgress(
  url: string,
  body: FormData,
  onProgress?: (percent: number) => void,
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => reject(new Error('Koneksi ke node terputus saat upload'));
    xhr.onabort = () => reject(new Error('Upload dibatalkan'));
    xhr.send(body);
  });
}
