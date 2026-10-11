import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/**
 * Auth guard untuk seluruh dashboard + API panel.
 * - /login, /register, /forgot-password, /reset-password → publik
 *   (yang sudah login & terverifikasi di-redirect ke /dashboard, kecuali
 *   /reset-password karena sesi recovery memang dipakai di halaman itu)
 * - /verify-email      → publik (halaman tunggu verifikasi + kirim ulang email)
 * - /auth/callback     → publik (landing link email Supabase: verifikasi & reset)
 * - /, /privacy, /tos  → publik (homepage dan legal pages, boleh diakses tanpa login)
 * - /api/announcements → publik (GET pengumuman aktif untuk banner; read-only)
 * - /api/remote/*      → publik (Wings; auth pakai Bearer token node di handler)
 * - /api/auth/*        → publik (termasuk OAuth callback cloud storage)
 * - /api/cron/*        → publik (Vercel Cron; divalidasi via CRON_SECRET di handler)
 * - /api/* lainnya     → butuh session + email terverifikasi (401/403 JSON bila tidak)
 * - halaman lain       → butuh session + email terverifikasi (redirect /login atau /verify-email)
 *
 * Middleware juga me-refresh cookie session Supabase.
 */

/** Halaman auth yang boleh dibuka tanpa session. */
const PUBLIC_AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];
const VERIFY_EMAIL_PAGE = '/verify-email';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === '/' ||
    pathname === '/privacy' ||
    pathname === '/tos' ||
    pathname === '/auth/callback' ||
    pathname === '/api/announcements' ||
    pathname.startsWith('/api/remote') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron')
  ) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  // Supabase belum dikonfigurasi → lepas semua (halaman menampilkan layar setup).
  if (!supabaseUrl.startsWith('http') || supabaseUrl.includes('xxxx') || supabaseAnonKey.length < 20) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isApi = pathname.startsWith('/api/');
  const isPublicAuthPage = PUBLIC_AUTH_PAGES.includes(pathname);
  const isVerifyEmailPage = pathname === VERIFY_EMAIL_PAGE;
  const isResetPasswordPage = pathname === '/reset-password';
  const emailConfirmed = Boolean(user?.email_confirmed_at);

  function redirectTo(path: string) {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (!user) {
    if (isApi) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (!isPublicAuthPage && !isVerifyEmailPage) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Email belum diverifikasi → hanya /verify-email yang boleh dibuka.
  // /reset-password dikecualikan: sesi recovery harus bisa dipakai untuk
  // menyetel password baru (link reset bisa dibuka sebelum verifikasi tuntas).
  if (!emailConfirmed && !isVerifyEmailPage && !isResetPasswordPage) {
    if (isApi) {
      return NextResponse.json(
        { error: 'Email belum diverifikasi. Cek inbox kamu untuk link verifikasi.' },
        { status: 403 },
      );
    }
    return redirectTo(VERIFY_EMAIL_PAGE);
  }

  // Sudah login & terverifikasi → halaman auth tidak relevan lagi.
  if (isPublicAuthPage || isVerifyEmailPage) {
    if (isResetPasswordPage) return response;
    return redirectTo('/dashboard');
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
