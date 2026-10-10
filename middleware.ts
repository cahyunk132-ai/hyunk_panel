import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/**
 * Auth guard untuk seluruh dashboard + API panel.
 * - /login             → publik (redirect ke / bila sudah login)
 * - /privacy           → publik (Privacy Policy, boleh diakses tanpa login)
 * - /api/remote/*      → publik (Wings; auth pakai Bearer token node di handler)
 * - /api/auth/*        → publik (termasuk OAuth callback cloud storage)
 * - /api/cron/*        → publik (Vercel Cron; divalidasi via CRON_SECRET di handler)
 * - /api/* lainnya     → butuh session, 401 JSON bila tidak ada
 * - halaman lain       → butuh session, redirect ke /login
 *
 * Middleware juga me-refresh cookie session Supabase.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname === '/privacy' ||
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
  const isLoginPage = pathname === '/login';

  if (!user) {
    if (isApi) {
      return NextResponse.json({ error: 'Tidak terautentikasi' }, { status: 401 });
    }
    if (!isLoginPage) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
