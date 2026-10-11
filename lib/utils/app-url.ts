/**
 * Base URL panel — dipakai untuk `emailRedirectTo` Supabase Auth (link verifikasi
 * email & reset password) supaya link di email selalu menunjuk balik ke panel.
 *
 * Urutan prioritas: NEXT_PUBLIC_APP_URL (eksplisit, aman di balik proxy/domain
 * custom) → origin request/browser saat ini.
 *
 * PENTING: URL ini harus terdaftar di Supabase Dashboard → Authentication →
 * URL Configuration → "Redirect URLs" (mis. https://panel.domain/auth/callback),
 * jika tidak Supabase akan memakai Site URL default dan link-nya tidak kembali
 * ke panel.
 */

function configuredAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');
}

/** Base URL untuk kode yang berjalan di browser. */
export function getBrowserAppUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
    return window.location.origin;
  }
  return configuredAppUrl();
}

/** Base URL untuk API route / server component (fallback: origin request). */
export function getServerAppUrl(fallbackOrigin?: string): string {
  return configuredAppUrl() || (fallbackOrigin ?? '').replace(/\/+$/, '');
}

/**
 * URL callback auth (`/auth/callback`) yang dipasang sebagai `emailRedirectTo`.
 * `type` dipakai callback untuk memutuskan halaman tujuan setelah token
 * ditukar: signup/email → dashboard, recovery/invite → /reset-password.
 */
export function authCallbackUrl(type: 'signup' | 'recovery' | 'invite', baseUrl?: string): string {
  const base = (baseUrl ?? getBrowserAppUrl()).replace(/\/+$/, '');
  if (!base) return '/auth/callback';
  return `${base}/auth/callback?type=${type}`;
}
