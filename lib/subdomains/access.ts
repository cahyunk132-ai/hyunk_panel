// ─── Aturan akses Subdomain Manager (satu sumber kebenaran) ──────────────────
// Dipakai API route (/api/servers/{id}/subdomain: POST & DELETE) DAN halaman
// /servers/{id}/network (penanda `canManage` di UI). Dulu keduanya punya cek
// sendiri: API sempat memakai `canManageSubdomain` versi sync yang hanya
// membandingkan `servers.owner_id`, sehingga buyer yang aksesnya datang dari
// `server_users` kena 403. Aturan ini async dan sengaja dicek di satu tempat.

import 'server-only';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { isPanelAdmin } from '@/lib/auth/roles';
import type { SessionUser } from '@/lib/auth/session';
import type { ServerRow } from '@/types';

/**
 * Boleh mengelola subdomain server ini?
 *
 * - Owner Panel / Admin: selalu boleh (semua server).
 * - Pemilik server (`servers.owner_id`): boleh.
 * - Buyer yang servernya dibuatkan admin: `owner_id` bukan dirinya, aksesnya
 *   hanya ada di tabel `server_users` → tetap boleh.
 *
 * Melempar `Error` bila query `server_users` gagal. Kegagalan query TIDAK boleh
 * diperlakukan sebagai "tidak boleh": kalau didiamkan, user yang sah dapat 403
 * menyesatkan ("bukan pemilik server") padahal masalahnya di database.
 */
export async function canManageSubdomain(user: SessionUser, server: ServerRow): Promise<boolean> {
  if (isPanelAdmin(user.role) || server.owner_id === user.id) return true;

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('server_users')
    .select('user_id')
    .eq('server_id', server.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Gagal memverifikasi akses server_users untuk ${user.id} @ ${server.id}: ${error.message}`,
    );
  }
  return !!data;
}

/**
 * Versi untuk server component / UI: tidak pernah melempar, gagal → `false`
 * (form disembunyikan, bukan halaman error 500).
 */
export async function canManageSubdomainSafe(user: SessionUser, server: ServerRow): Promise<boolean> {
  try {
    return await canManageSubdomain(user, server);
  } catch (err) {
    console.warn(`[subdomains] canManageSubdomain gagal: ${describeError(err)}`);
    return false;
  }
}

/**
 * Guard untuk API route: kembalikan `null` bila boleh lanjut, atau Response
 * (403 / 500) yang siap di-`return` handler.
 */
export async function requireSubdomainAccess(
  user: SessionUser,
  server: ServerRow,
): Promise<Response | null> {
  let allowed: boolean;
  try {
    allowed = await canManageSubdomain(user, server);
  } catch (err) {
    const message = describeError(err);
    console.error(`[subdomains] ${message}`);
    return Response.json({ error: message }, { status: 500 });
  }

  if (allowed) return null;
  return Response.json(
    {
      error: 'Kamu bukan pemilik atau anggota server ini. Hubungi admin untuk menambah akses.',
    },
    { status: 403 },
  );
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : 'Gagal memverifikasi akses server';
}
