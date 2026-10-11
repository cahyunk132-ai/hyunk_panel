/** Batas ukuran file yang boleh dipilih user (sebelum kompres). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Batas panjang data URL yang disimpan ke localStorage (~2.5 MB). */
export const MAX_STORED_CHARS = 2_500_000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal membaca gambar.'));
    img.src = src;
  });
}

/**
 * Ubah file gambar user menjadi data URL JPEG (base64) yang cukup kecil untuk
 * localStorage: di-resize ke maks 1920px lalu kualitas diturunkan bertahap.
 */
export async function imageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('File harus berupa gambar.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Ukuran gambar maksimal 15 MB.');

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    let maxSide = 1920;
    let quality = 0.85;

    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Browser tidak mendukung pemrosesan gambar.');
      // Latar hitam untuk PNG transparan agar tidak berubah jadi hitam saat JPEG.
      ctx.fillStyle = '#0f1117';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= MAX_STORED_CHARS) return dataUrl;

      quality -= 0.15;
      if (quality < 0.5) {
        quality = 0.8;
        maxSide = Math.round(maxSide * 0.75);
      }
    }
    throw new Error('Gambar terlalu besar setelah dikompres. Coba gambar lain.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
