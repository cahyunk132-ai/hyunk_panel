// ─── Konfigurasi & validasi Subdomain Manager (client-safe, tanpa server-only) ─
// Dipakai API route (validasi otoritatif) dan komponen client (validasi realtime).

/** Base domain untuk semua subdomain server. Override via NEXT_PUBLIC_BASE_DOMAIN. */
export const BASE_DOMAIN =
  process.env.NEXT_PUBLIC_BASE_DOMAIN?.trim().toLowerCase() || 'wangstore.web.id';

export const SUBDOMAIN_MIN_LENGTH = 3;
export const SUBDOMAIN_MAX_LENGTH = 32;

/**
 * Subdomain sistem yang tidak boleh dipakai user — jangan sampai bentrok
 * dengan panel, API, node, atau layanan infrastruktur lain.
 */
export const SUBDOMAIN_BLACKLIST: readonly string[] = [
  'panel',
  'api',
  'node',
  'node1',
  'node2',
  'node3',
  'www',
  'mail',
  'toko',
  'web',
  'shield',
  'status',
  'tugas',
  'website',
];

/** Huruf kecil, angka, dan strip; tanpa strip di awal/akhir (label DNS aman). */
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface SubdomainCheck {
  ok: boolean;
  error?: string;
}

/**
 * Validasi format nama subdomain (bukan ketersediaan — itu cek ke database).
 * Aturan: huruf kecil, angka, strip; 3–32 karakter; tidak boleh nama sistem.
 */
export function validateSubdomain(raw: string): SubdomainCheck {
  const name = raw.trim().toLowerCase();
  if (!name) return { ok: false, error: 'Nama subdomain wajib diisi' };
  if (name.length < SUBDOMAIN_MIN_LENGTH) {
    return { ok: false, error: `Minimal ${SUBDOMAIN_MIN_LENGTH} karakter` };
  }
  if (name.length > SUBDOMAIN_MAX_LENGTH) {
    return { ok: false, error: `Maksimal ${SUBDOMAIN_MAX_LENGTH} karakter` };
  }
  if (!SUBDOMAIN_PATTERN.test(name)) {
    return {
      ok: false,
      error: 'Hanya huruf kecil, angka, dan strip (-); strip tidak boleh di awal/akhir',
    };
  }
  if (SUBDOMAIN_BLACKLIST.includes(name)) {
    return { ok: false, error: 'Subdomain ini adalah nama sistem dan tidak tersedia' };
  }
  return { ok: true };
}

/** Bentuk FQDN lengkap: "{subdomain}.{BASE_DOMAIN}". */
export function buildFullDomain(subdomain: string): string {
  return `${subdomain.trim().toLowerCase()}.${BASE_DOMAIN}`;
}

/** Normalisasi input user → slug subdomain (lowercase, trim). */
export function normalizeSubdomain(raw: string): string {
  return raw.trim().toLowerCase();
}
