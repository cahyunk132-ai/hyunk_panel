export const APP_NAME = 'HYUNK PANEL';
export const APP_TAGLINE = 'One Panel. Every Node. Every Server.';

/** Preset stop per tipe server — dipakai Remote API (process_configuration.stop). */
export const DEFAULT_STOP_COMMANDS: Array<{ match: RegExp; value: string }> = [
  { match: /source/i, value: 'quit' },
];

/** Endpoint Wings yang diizinkan keluar dari satu tempat: lib/wings/client.ts */
export const WINGS_DEFAULT_PORT = 8080;

/** TTL sementara untuk token WebSocket console (5 menit — sesuai aturan keamanan). */
export const WS_TOKEN_TTL_SECONDS = 300;

/** Panjang maksimum konten file yang boleh diedit di browser (2 MB). */
export const MAX_EDITABLE_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Batas ukuran body request function serverless (Vercel ~4.5 MB). Dipakai jalur
 * cadangan upload file (panel → Wings) saat browser tidak bisa menjangkau node
 * langsung; file lebih besar harus lewat jalur langsung browser → Wings.
 */
export const PROXY_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** Baris per halaman tabel monitoring backup admin (GET /api/admin/backup-logs). */
export const BACKUP_LOG_PAGE_SIZE = 20;

/**
 * Arsip yang bisa diekstrak Wings lewat `POST /api/servers/{uuid}/files/decompress`.
 *
 * Wings memakai mholt/archives (+ bodgit/sevenzip, nwaples/rardecode), jadi yang
 * didukung node: zip, tar (+ gz/bz2/xz/zst/lz4/br/sz/lz), 7z, dan rar — termasuk
 * kompresi satu file (gz/bz2/xz/zst). Daftar ini dipakai UI untuk memunculkan
 * tombol "Ekstrak" (sebelumnya hanya .zip/.tar/.gz, sehingga .7z & .rar tidak
 * bisa diekstrak dari panel walau node-nya sanggup).
 */
export const EXTRACTABLE_ARCHIVE_EXTENSIONS: readonly string[] = [
  '7z',
  'rar',
  'zip',
  'tar',
  'tar.gz',
  'tgz',
  'tar.bz2',
  'tbz2',
  'tbz',
  'tar.xz',
  'txz',
  'tar.zst',
  'tzst',
  'tar.lz4',
  'tar.br',
  'tar.sz',
  'tar.lz',
  'gz',
  'bz2',
  'xz',
  'zst',
  'lz4',
  'br',
  'sz',
  'lz',
];

const EXTRACTABLE_ARCHIVE_RE = new RegExp(
  `\\.(${EXTRACTABLE_ARCHIVE_EXTENSIONS.map((ext) => ext.replace(/\./g, '\\.')).join('|')})$`,
  'i',
);

/** `true` bila Wings bisa mengekstrak file dengan nama ini. */
export function isExtractableArchive(name: string): boolean {
  return EXTRACTABLE_ARCHIVE_RE.test(name);
}
