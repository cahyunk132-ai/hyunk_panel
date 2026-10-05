import 'server-only';
import type { ServerPermission, ServerRow } from '@/types';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import type { SessionUser } from './session';

/** Ambil server berdasar id internal ATAU uuid wings (keduanya unik). */
export async function getServerByIdOrUuid(idOrUuid: string): Promise<ServerRow | null> {
  const service = getSupabaseServiceClient();
  const { data } = await service
    .from('servers')
    .select('*')
    .or(`id.eq.${idOrUuid},uuid.eq.${idOrUuid}`)
    .maybeSingle();
  return (data as ServerRow | null) ?? null;
}

/** Daftar permission efektif user terhadap satu server. Admin → ['*']. */
export async function getEffectivePermissions(
  user: SessionUser,
  server: ServerRow,
): Promise<string[]> {
  if (user.role === 'admin' || server.owner_id === user.id) return ['*'];
  const service = getSupabaseServiceClient();
  const { data } = await service
    .from('server_users')
    .select('permissions')
    .eq('server_id', server.id)
    .eq('user_id', user.id)
    .maybeSingle();
  return (data?.permissions as ServerPermission[] | undefined) ?? [];
}

export function permissionsInclude(have: string[], needed: string): boolean {
  if (have.includes('*')) return true;
  if (have.includes(needed)) return true;
  // Granular: 'files' mencakup files.read/files.edit, 'console' mencakup console.send.
  const [domain] = needed.split('.');
  if (domain && have.includes(domain)) return true;
  // Pemetaan aksi power → permission.
  const aliases: Record<string, string> = { power: 'start' };
  const alias = aliases[needed];
  return alias ? have.includes(alias) : false;
}

/**
 * checkPermission(user, action, serverId) — helper utama RBAC.
 * Mengembalikan null bila diizinkan, atau Response 403/404 bila ditolak.
 */
export async function checkPermission(
  user: SessionUser,
  action: string,
  serverIdOrUuid: string,
): Promise<{ server: ServerRow } | Response> {
  const server = await getServerByIdOrUuid(serverIdOrUuid);
  if (!server) {
    return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });
  }
  if (server.is_suspended && user.role !== 'admin') {
    return Response.json({ error: 'Server sedang disuspend' }, { status: 403 });
  }
  const perms = await getEffectivePermissions(user, server);
  if (!permissionsInclude(perms, action)) {
    return Response.json({ error: `Butuh permission "${action}"` }, { status: 403 });
  }
  return { server };
}
