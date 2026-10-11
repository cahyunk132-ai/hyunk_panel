import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { requireServerAccess } from '@/lib/subdomains/access';
import { logActivity } from '@/lib/wings/resolve';
import {
  BASE_DOMAIN,
  SERVER_HAS_SUBDOMAIN_MESSAGE,
  buildFullDomain,
  normalizeSubdomain,
  validateSubdomain,
} from '@/lib/subdomains';
import type { ServerRow, ServerSubdomainRow } from '@/types';

export const runtime = 'nodejs';

const SUBDOMAIN_COLUMNS = 'id, server_id, subdomain, full_domain, port, created_at, updated_at';

// Sistem subdomain: SATU subdomain aktif per server — tidak ada kuota per user.
// Siapa pun yang punya akses ke server ini (owner, anggota `server_users`, atau
// Owner Panel/Admin) boleh daftar dan hapus. Aturan akses di
// '@/lib/subdomains/access' supaya API route INI dan halaman
// /servers/{id}/network memakai satu sumber kebenaran — jangan bikin salinan
// lokal lagi: dulu salinan sync yang hanya cek `servers.owner_id` di sini
// membuat buyer (akses via `server_users`) kena 403.

/** Subdomain aktif server (maksimal satu — unique index di `server_id`). */
async function fetchActiveSubdomain(serverId: string): Promise<ServerSubdomainRow | null> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('server_subdomains')
    .select(SUBDOMAIN_COLUMNS)
    .eq('server_id', serverId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ServerSubdomainRow | null) ?? null;
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

  let subdomainRow: ServerSubdomainRow | null;
  let targetPort: number | null;
  try {
    [subdomainRow, targetPort] = await Promise.all([
      fetchActiveSubdomain(result.server.id),
      resolveTargetPort(result.server),
    ]);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal memuat subdomain' },
      { status: 500 },
    );
  }

  return Response.json({
    subdomain: subdomainRow,
    base_domain: BASE_DOMAIN,
    target: subdomainRow ? { host: subdomainRow.full_domain, port: subdomainRow.port } : null,
    default_port: targetPort,
  });
}

/**
 * POST /api/servers/{id}/subdomain — daftarkan subdomain baru untuk server.
 * Body: { subdomain: string, port?: number }. Port default = port allocation utama.
 *
 * Siapa pun yang punya akses ke server ini boleh mendaftar (owner, anggota
 * `server_users`, atau Owner Panel/Admin) — tanpa kuota per user. Satu server
 * hanya boleh punya SATU subdomain aktif → 409 bila sudah ada.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const result = await checkPermission(user, 'server.read', params.id);
  if (result instanceof Response) return result;
  const server = result.server;

  const denied = await requireServerAccess(user, server);
  if (denied) return denied;

  // Satu subdomain aktif per server — dicek lebih awal supaya user dapat pesan
  // yang jelas (bukan error unique-constraint dari database).
  let existing: ServerSubdomainRow | null;
  try {
    existing = await fetchActiveSubdomain(server.id);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal memeriksa subdomain server' },
      { status: 500 },
    );
  }
  if (existing) {
    return Response.json({ error: SERVER_HAS_SUBDOMAIN_MESSAGE }, { status: 409 });
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

  const { data: created, error } = await service
    .from('server_subdomains')
    .insert({ server_id: server.id, subdomain, full_domain: fullDomain, port })
    .select(SUBDOMAIN_COLUMNS)
    .single();
  if (error) {
    // 23505 = unique violation: nama subdomain sudah dipakai di sistem, atau
    // request paralel mendaftarkan subdomain kedua untuk server yang sama.
    if (error.code === '23505') {
      const conflict = `${error.message ?? ''} ${error.details ?? ''}`;
      if (/server_id/.test(conflict)) {
        return Response.json({ error: SERVER_HAS_SUBDOMAIN_MESSAGE }, { status: 409 });
      }
      return Response.json({ error: 'Subdomain sudah dipakai di sistem' }, { status: 409 });
    }
    return Response.json({ error: error.message }, { status: 500 });
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

/**
 * DELETE /api/servers/{id}/subdomain — hapus subdomain aktif server.
 * Siapa pun yang punya akses ke server ini boleh menghapusnya (tanpa kuota).
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const result = await checkPermission(user, 'server.read', params.id);
  if (result instanceof Response) return result;
  const server = result.server;

  const denied = await requireServerAccess(user, server);
  if (denied) return denied;

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
