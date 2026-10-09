import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';

export const runtime = 'nodejs';

/**
 * GET /api/auth/storage/connect?provider=gdrive|dropbox|onedrive
 *
 * Memulai OAuth flow: simpan state di cookie (CSRF protection), lalu redirect
 * ke halaman consent provider. Callback ada di /api/auth/storage/callback/{provider}.
 */
export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const provider = request.nextUrl.searchParams.get('provider') ?? '';
  const fail = (message: string) =>
    NextResponse.redirect(
      new URL(`/storage?error=${encodeURIComponent(message)}`, request.url),
    );

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
  if (!base) return fail('NEXT_PUBLIC_APP_URL belum di-set di environment');
  if (!['gdrive', 'dropbox', 'onedrive'].includes(provider)) {
    return fail('Provider tidak dikenal (gdrive/dropbox/onedrive)');
  }
  if (provider === 'onedrive') {
    return fail('OneDrive belum tersedia — coming soon');
  }

  const state = crypto.randomUUID();
  const redirectUri = `${base}/api/auth/storage/callback/${provider === 'gdrive' ? 'google' : provider}`;

  let authorizeUrl: string;
  if (provider === 'gdrive') {
    const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
    if (!clientId) return fail('GOOGLE_CLIENT_ID belum di-set di environment');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      // drive.file: panel hanya bisa mengakses file/folder yang dibuat panel sendiri.
      scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent', // wajib agar Google mengeluarkan refresh_token
      state,
    });
    authorizeUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  } else {
    const appKey = process.env.DROPBOX_APP_KEY ?? '';
    if (!appKey) return fail('DROPBOX_APP_KEY belum di-set di environment');
    const params = new URLSearchParams({
      client_id: appKey,
      redirect_uri: redirectUri,
      response_type: 'code',
      token_access_type: 'offline', // wajib agar Dropbox mengeluarkan refresh_token
      state,
    });
    authorizeUrl = `https://www.dropbox.com/oauth2/authorize?${params}`;
  }

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set('hyunk_storage_oauth', `${provider}:${state}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}
