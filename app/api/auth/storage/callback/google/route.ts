import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { encryptSecret } from '@/lib/storage/crypto';

export const runtime = 'nodejs';

/**
 * GET /api/auth/storage/callback/google?code=...&state=...
 *
 * Tukar authorization code → access token + refresh token, simpan (terenkripsi)
 * ke storage_providers, lalu redirect ke /storage.
 */
export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const fail = (message: string) =>
    NextResponse.redirect(new URL(`/storage?error=${encodeURIComponent(message)}`, request.url));

  try {
    const code = request.nextUrl.searchParams.get('code');
    const state = request.nextUrl.searchParams.get('state');
    const cookie = request.cookies.get('hyunk_storage_oauth')?.value ?? '';
    const [cookieProvider, cookieState] = cookie.split(':');
    if (!code || !state || cookieProvider !== 'gdrive' || !cookieState || cookieState !== state) {
      return fail('State OAuth tidak valid — silakan coba hubungkan ulang');
    }

    const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
    const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
    if (!clientId || !clientSecret) return fail('Kredensial Google belum di-set di server');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${base}/api/auth/storage/callback/google`,
        grant_type: 'authorization_code',
      }),
      cache: 'no-store',
    });
    const tokens = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !tokens.access_token) {
      return fail(`Gagal menukar kode OAuth Google: ${tokens.error ?? tokenRes.status} ${tokens.error_description ?? ''}`.trim());
    }

    // Email akun Google untuk nama provider yang mudah dikenali.
    let email = '';
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        cache: 'no-store',
      });
      if (infoRes.ok) {
        email = ((await infoRes.json()) as { email?: string }).email ?? '';
      }
    } catch {
      // non-fatal — nama tetap bisa dibuat tanpa email
    }

    const service = getSupabaseServiceClient();
    const { error } = await service.from('storage_providers').insert({
      user_id: user.id,
      provider: 'gdrive',
      name: `Google Drive${email ? ` (${email})` : ''}`,
      access_token: encryptSecret(tokens.access_token),
      refresh_token: tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null,
      token_expires_at: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      config: {},
      is_active: true,
    });
    if (error) return fail(`Gagal menyimpan provider: ${error.message}`);

    const res = NextResponse.redirect(new URL('/storage?connected=gdrive', request.url));
    res.cookies.delete('hyunk_storage_oauth');
    return res;
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Error tidak diketahui');
  }
}
