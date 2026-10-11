import { NextRequest } from 'next/server';
import { requireUser, type SessionUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { isPanelAdmin } from '@/lib/auth/roles';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';
import {
  BASE_DOMAIN,
  SUBDOMAIN_QUOTA_EXCEEDED_MESSAGE,
  SUBDOMAIN_QUOTA_PER_USER,
  buildFullDomain,
  hasUnlimitedSubdomainQuota,
  normalizeSubdomain,
  validateSubdomain,
} from '@/lib/subdomains';
import type { ServerRow, ServerSubdomainRow, SubdomainQuota } from '@/types';

export const runtime = 'nodejs';

const SUBDOMAIN_COLUMNS = 'id, server_id, subdomain, full_domain, port, created_at, updated_at';

/**
 * Kelola subdomain: semua role boleh, tapi hanya untuk server miliknya sendiri.
 * Owner Panel/Admin boleh kelola subdomain server siapa pun (lihat migrasi 006).
 */
function canManageSubdomain(user: SessionUser, server: ServerRow): boolean {
  return isPanelAdmin(user.role) || server.owner_id === user.id;
}

/**
 * Jumlah subdomain milik user, dihitung dari SEMUA server yang dia miliki:
 *   SELECT COUNT(*) FROM server_subdomains ss
 *   JOIN servers s ON s.id = ss.server_id
 *   WHERE s.owner_id = [user_id]
 */
async function countUserSubdomains(userId: string): Promise<number> {
  const service = getSupabaseServiceClient();
  const { count, error } = await service
    .from('server_subdomains')
    .select('id, servers!inner(owner_id)', { count: 'exact', head: true })
    .eq('servers.owner_id', userId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Kuota subdomain user yang sedang login. Owner Panel/Admin = tanpa batas. */
async function getSubdomainQuota(user: SessionUser): Promise<SubdomainQuota> {
  const used = await countUserSubdomains(user.id);
  const unlimited = hasUnlimitedSubdomainQuota(user.role);
  return { used, limit: unlimited ? null : SUBDOMAIN_QUOTA_PER_USER, unlimited };
}

/** Port tujuan reverse proxy: port allocation utama server. */
async function resolveTargetPort(server: ServerRow): Promise<number | null> {
  const service = getSupabaseServiceClient();
  if (server.allocation_id) {
    const { data } = await service
      .from('allocations')
      .select('port')
      .eq('id', server.allocation_id)
      .maybeSingle();
    if (data?.port) return data.port as number;
  }
  const { data } = await service
    .from('allocations')
    .select('port')
    .eq('assigned_to', server.id)
    .order('port', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.port as number | undefined) ?? null;
}

/**
 * GET /api/servers/{id}/subdomain — subdomain aktif server ini.
 * GET /api/servers/{id}/subdomain?check=nama — cek ketersediaan subdomain
 * (dipakai validasi realtime di form Network). Selalu 200; `available` false
 * bila format salah / sudah dipakai / kena blacklist.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const result = await checkPermission(user, 'server.read', params.id);
  if (result instanceof Response) return result;

  const service = getSupabaseServiceClient();
  const checkName = request.nextUrl.searchParams.get('check');

  if (checkName !== null) {
    const subdomain = normalizeSubdomain(checkName);
    const format = validateSubdomain(subdomain);
    if (!format.ok) {
      return Response.json({
        available: false,
        subdomain,
        full_domain: subdomain ? buildFullDomain(subdomain) : null,
        error: format.error,
      });
    }

    const { data: taken, error } = await service
      .from('server_subdomains')
      .select('id, server_id')
      .or(`subdomain.eq.${subdomain},full_domain.eq.${buildFullDomain(subdomain)}`)
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });

    if (taken) {
      return Response.json({
        available: false,
        subdomain,
        full_domain: buildFullDomain(subdomain),
        error:
          taken.server_id === result.server.id
            ? 'Subdomain ini sudah aktif di server kamu'
            : 'Subdomain sudah dipakai',
      });
    }

    return Response.json({
      available: true,
      subdomain,
      full_domain: buildFullDomain(subdomain),
    });
  }

  let quota: SubdomainQuota;
  const [{ data: subdomainRow, error }, targetPort] = await Promise.all([
    service
      .from('server_subdomains')
      .select(SUBDOMAIN_COLUMNS)
      .eq('server_id', result.server.id)
      .maybeSingle(),
    resolveTargetPort(result.server),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  try {
    quota = await getSubdomainQuota(user);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal menghitung kuota subdomain' },
      { status: 500 },
    );
  }

  return Response.json({
    subdomain: (subdomainRow as ServerSubdomainRow | null) ?? null,
    base_domain: BASE_DOMAIN,
    target: subdomainRow
      ? { host: subdomainRow.full_domain, port: (subdomainRow as ServerSubdomainRow).port }
      : null,
    default_port: targetPort,
    quota,
  });
}

/**
 * POST /api/servers/{id}/subdomain — daftarkan subdomain baru untuk server.
 * Body: { subdomain: string, port?: number }. Port default = port allocation utama.
 *
 * Semua user boleh mendaftarkan subdomain untuk server MILIKNYA sendiri.
 * Kuota: moderator/user/subuser maks. SUBDOMAIN_QUOTA_PER_USER subdomain
 * (total dari semua server miliknya) → 429 bila habis. Owner Panel/Admin tanpa batas.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const result = await checkPermission(user, 'server.read', params.id);
  if (result instanceof Response) return result;
  const server = result.server;

  if (!canManageSubdomain(user, server)) {
    return Response.json(
      { error: 'Kamu hanya dapat mendaftarkan subdomain untuk server milikmu sendiri' },
      { status: 403 },
    );
  }

  // Cek kuota sebelum register (Owner Panel/Admin dikecualikan).
  if (!hasUnlimitedSubdomainQuota(user.role)) {
    let used: number;
    try {
      used = await countUserSubdomains(user.id);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Gagal menghitung kuota subdomain' },
        { status: 500 },
      );
    }
    if (used >= SUBDOMAIN_QUOTA_PER_USER) {
      return Response.json(
        {
          error: SUBDOMAIN_QUOTA_EXCEEDED_MESSAGE,
          quota: { used, limit: SUBDOMAIN_QUOTA_PER_USER, unlimited: false } satisfies SubdomainQuota,
        },
        { status: 429 },
      );
    }
  }

  const body = (await request.json().catch(() => null)) as
    | { subdomain?: unknown; port?: unknown }
    | null;
  if (!body || typeof body.subdomain !== 'string') {
    return Response.json({ error: 'subdomain wajib diisi' }, { status: 400 });
  }

  const subdomain = normalizeSubdomain(body.subdomain);
  const format = validateSubdomain(subdomain);
  if (!format.ok) return Response.json({ error: format.error }, { status: 400 });

  let port: number;
  if (body.port !== undefined && body.port !== null) {
    port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return Response.json({ error: 'Port harus bilangan bulat 1-65535' }, { status: 400 });
    }
  } else {
    const resolved = await resolveTargetPort(server);
    if (resolved === null) {
      return Response.json(
        { error: 'Server belum memiliki port allocation. Tentukan port secara manual.' },
        { status: 400 },
      );
    }
    port = resolved;
  }

  const fullDomain = buildFullDomain(subdomain);
  const service = getSupabaseServiceClient();

  // Satu subdomain aktif per server.
  const { data: existing } = await service
    .from('server_subdomains')
    .select('id')
    .eq('server_id', server.id)
    .maybeSingle();
  if (existing) {
    return Response.json(
      { error: 'Server sudah memiliki subdomain. Hapus subdomain lama terlebih dahulu.' },
      { status: 409 },
    );
  }

  const { data: created, error } = await service
    .from('server_subdomains')
    .insert({ server_id: server.id, subdomain, full_domain: fullDomain, port })
    .select(SUBDOMAIN_COLUMNS)
    .single();
  if (error) {
    // 23505 = unique violation (subdomain/full_domain/server_id sudah dipakai).
    if (error.code === '23505') {
      return Response.json({ error: 'Subdomain sudah dipakai di sistem' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  // Cek ulang setelah insert: dua request paralel (server berbeda) bisa lolos
  // cek awal bersamaan. Bila total melewati kuota, batalkan insert ini.
  if (!hasUnlimitedSubdomainQuota(user.role)) {
    const usedAfter = await countUserSubdomains(user.id).catch(() => null);
    if (usedAfter !== null && usedAfter > SUBDOMAIN_QUOTA_PER_USER) {
      await service.from('server_subdomains').delete().eq('id', (created as ServerSubdomainRow).id);
      return Response.json(
        {
          error: SUBDOMAIN_QUOTA_EXCEEDED_MESSAGE,
          quota: {
            used: usedAfter - 1,
            limit: SUBDOMAIN_QUOTA_PER_USER,
            unlimited: false,
          } satisfies SubdomainQuota,
        },
        { status: 429 },
      );
    }
  }

  await logActivity({
    userId: user.id,
    serverId: server.id,
    action: 'server:subdomain-add',
    metadata: { subdomain, full_domain: fullDomain, port },
  });

  return Response.json(
    {
      subdomain: created as ServerSubdomainRow,
      message: `Subdomain ${fullDomain} berhasil didaftarkan`,
    },
    { status: 201 },
  );
}

/** DELETE /api/servers/{id}/subdomain — hapus subdomain aktif server. */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const result = await checkPermission(user, 'server.read', params.id);
  if (result instanceof Response) return result;
  const server = result.server;

  if (!canManageSubdomain(user, server)) {
    return Response.json(
      { error: 'Kamu hanya dapat menghapus subdomain dari server milikmu sendiri' },
      { status: 403 },
    );
  }

  const service = getSupabaseServiceClient();
  const { data: removed, error } = await service
    .from('server_subdomains')
    .delete()
    .eq('server_id', server.id)
    .select(SUBDOMAIN_COLUMNS)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!removed) return Response.json({ error: 'Server tidak memiliki subdomain aktif' }, { status: 404 });

  await logActivity({
    userId: user.id,
    serverId: server.id,
    action: 'server:subdomain-remove',
    metadata: {
      subdomain: (removed as ServerSubdomainRow).subdomain,
      full_domain: (removed as ServerSubdomainRow).full_domain,
      port: (removed as ServerSubdomainRow).port,
    },
  });

  return Response.json({
    ok: true,
    message: `Subdomain ${(removed as ServerSubdomainRow).full_domain} dihapus`,
  });
}
