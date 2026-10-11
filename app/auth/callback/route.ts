import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Type link email Supabase yang dikenali callback ini. */
const OTP_TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const;
type OtpType = (typeof OTP_TYPES)[number];

function isOtpType(value: string | null): value is OtpType {
  return !!value && (OTP_TYPES as readonly string[]).includes(value);
}

function redirectTo(origin: string, pathname: string, params: Record<string, string>) {
  const url = new URL(pathname, origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

/**
 * GET /auth/callback — satu-satunya landing page link email Supabase Auth
 * (verifikasi signup, reset password, invite, magic link).
 *
 * Supabase mengirim `?code=...` (PKCE, default @supabase/ssr) atau
 * `?token_hash=...&type=...` (flow OTP lama). Keduanya ditukar jadi session di
 * sini (cookie di-set server-side), lalu user diarahkan ke:
 *   - type=recovery|invite → /reset-password (wajib ganti password dulu)
 *   - lainnya              → /dashboard?verified=1
 *
 * URL ini harus didaftarkan di Supabase → Authentication → URL Configuration →
 * Redirect URLs.
 */
export async function GET(request: NextRequest) {
  const { origin } = request.nextUrl;
  const code = request.nextUrl.searchParams.get('code');
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const rawType = request.nextUrl.searchParams.get('type');
  const type = isOtpType(rawType) ? rawType : null;

  const supabase = getSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return redirectTo(origin, '/login', {
        auth: 'failed',
        reason: 'Link tidak valid atau sudah kedaluwarsa. Silakan minta link baru.',
      });
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      return redirectTo(origin, '/login', {
        auth: 'failed',
        reason: 'Link tidak valid atau sudah kedaluwarsa. Silakan minta link baru.',
      });
    }
  } else {
    return redirectTo(origin, '/login', {
      auth: 'failed',
      reason: 'Token auth tidak ditemukan pada link ini.',
    });
  }

  if (type === 'recovery' || type === 'invite') {
    return redirectTo(origin, '/reset-password', {});
  }
  return redirectTo(origin, '/dashboard', { verified: '1' });
}
