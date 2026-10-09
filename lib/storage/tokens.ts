import 'server-only';
import type { StorageProviderRow } from '@/types';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { decryptSecret, encryptSecret } from './crypto';

/**
 * Token manager untuk provider OAuth (Google Drive & Dropbox).
 *
 * Sebelum upload: cek token_expires_at — jika expired (atau tinggal < 60 detik),
 * refresh token dipakai untuk menukar access token baru, lalu token baru
 * (terenkripsi) disimpan kembali ke database.
 *
 * Google : POST https://oauth2.googleapis.com/token
 * Dropbox: POST https://api.dropboxapi.com/oauth2/token
 */

interface RefreshedToken {
  access_token: string;
  /** Masa berlaku dalam detik. */
  expires_in: number;
}

async function refreshGoogle(refreshToken: string): Promise<RefreshedToken> {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET belum di-set di environment');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Refresh token Google gagal: ${json.error ?? res.status} ${json.error_description ?? ''}`.trim(),
    );
  }
  return { access_token: json.access_token, expires_in: json.expires_in ?? 3600 };
}

async function refreshDropbox(refreshToken: string): Promise<RefreshedToken> {
  const appKey = process.env.DROPBOX_APP_KEY ?? '';
  const appSecret = process.env.DROPBOX_APP_SECRET ?? '';
  if (!appKey || !appSecret) {
    throw new Error('DROPBOX_APP_KEY / DROPBOX_APP_SECRET belum di-set di environment');
  }
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: appKey,
      client_secret: appSecret,
    }),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Refresh token Dropbox gagal: ${json.error ?? res.status} ${json.error_description ?? ''}`.trim(),
    );
  }
  return { access_token: json.access_token, expires_in: json.expires_in ?? 14400 };
}

/**
 * Kembalikan access token yang masih valid untuk provider OAuth.
 * Refresh + update database bila sudah expired. Provider non-OAuth
 * (s3/sftp/webdav) tidak memakai access token.
 */
export async function getValidAccessToken(provider: StorageProviderRow): Promise<string> {
  if (provider.provider !== 'gdrive' && provider.provider !== 'dropbox') {
    return provider.access_token ? decryptSecret(provider.access_token) : '';
  }

  const now = Date.now();
  const expiresAt = provider.token_expires_at
    ? new Date(provider.token_expires_at).getTime()
    : 0;

  if (provider.access_token && expiresAt > now + 60_000) {
    return decryptSecret(provider.access_token);
  }

  if (!provider.refresh_token) {
    throw new Error(
      `Token ${provider.provider} sudah expired dan tidak ada refresh token — hubungkan ulang storage dari halaman Storage`,
    );
  }

  const refreshToken = decryptSecret(provider.refresh_token);
  const refreshed =
    provider.provider === 'gdrive'
      ? await refreshGoogle(refreshToken)
      : await refreshDropbox(refreshToken);

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from('storage_providers')
    .update({
      access_token: encryptSecret(refreshed.access_token),
      token_expires_at: new Date(now + refreshed.expires_in * 1000).toISOString(),
    })
    .eq('id', provider.id);
  if (error) {
    throw new Error(`Gagal menyimpan token baru ke database: ${error.message}`);
  }

  return refreshed.access_token;
}
