import { NextRequest } from 'next/server';
import { requireUser, type SessionUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { requireSubdomainAccess } from '@/lib/subdomains/access';
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

// Aturan akses subdomain (siapa yang boleh daftar/hapus) ada di
// '@/lib/subdomains/access' supaya dipakai API route INI dan halaman
// /servers/{id}/network dari satu sumber kebenaran — jangan bikin salinan
// lokal lagi: dulu salinan sync yang hanya cek `servers.owner_id` di sini
// membuat buyer (akses via `server_users`) kena 403.

/** Nama SQL function penghitung kuota (dibuat di migrasi 008). */
const COUNT_SUBDOMAINS_RPC = 'count_user_subdomains';
/** Jumlah id server per query `.in()` — jaga URL request tetap pendek. */
const SERVER_ID_CHUNK_SIZE = 200;
/** Supabase membatasi 1000 baris per request → id server diambil ber-paging. */
const SERVER_ID_PAGE_SIZE = 1000;
/** Bila RPC belum tersedia, coba lagi paling cepat setelah jeda ini (ms). */
const RPC_RETRY_AFTER_MS = 5 * 60 * 1000;

/**
 * RPC `count_user_subdomains` belum ada (migrasi 008 belum dijalankan).
 * Di-cache per proses supaya kita tidak memanggil function yang gagal terus;
 * kedaluwarsa setelah RPC_RETRY_AFTER_MS.
 */
let rpcUnavailableUntil = 0;

/**
 * Jumlah subdomain yang dihitung ke kuota user.
 *
 * Dihitung dari SEMUA server yang bisa diakses user — bukan hanya server dengan
 * `servers.owner_id = user.id`. Buyer yang servernya dibuat admin tidak punya
 * `owner_id` di tabel servers; mereka hanya terdaftar di `server_users`,
 * sehingga hitungan lama selalu 0 dan kuota tidak pernah berkurang.
 *
 * Logika utama ada di SQL function `public.count_user_subdomains(p_user_id)`
 * (supabase/migrations/008_count_user_subdomains.sql):
 *
 *   SELECT COUNT(DISTINCT ss.id)
 *   FROM server_subdomains ss
 *   JOIN servers s ON s.id = ss.server_id
 *   LEFT JOIN server_users su
 *     ON su.server_id = ss.server_id AND su.user_id = p_user_id
 *   WHERE s.owner_id = p_user_id OR su.user_id = p_user_id
 *
 * Bila function itu belum ada di database, jatuh ke hitungan manual lewat
 * PostgREST (lihat `countUserSubdomainsByQueries`).
 */
async function countUserSubdomains(userId: string): Promise<number> {
  const service = getSupabaseServiceClient();

  if (Date.now() >= rpcUnavailableUntil) {
    const { data, error } = await service.rpc(COUNT_SUBDOMAINS_RPC, { p_user_id: userId });
    if (!error) {
      rpcUnavailableUntil = 0;
      return toCount(data);
    }
    if (!isMissingRpcError(error)) throw new Error(error.message);

    // Migrasi 008 belum dijalankan → pakai fallback, jangan spam RPC gagal.
    rpcUnavailableUntil = Date.now() + RPC_RETRY_AFTER_MS;
    console.warn(
      `[subdomains] ${COUNT_SUBDOMAINS_RPC} belum tersedia (${error.message}); ` +
        'memakai hitungan fallback. Jalankan supabase/migrations/008_count_user_subdomains.sql.',
    );
  }

  return countUserSubdomainsByQueries(service, userId);
}

/** Normalisasi hasil RPC (bisa number, string angka, atau null) ke hitungan. */
function toCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

/** Deteksi "function belum ada di database" (PGRST202 / 42883) vs error asli. */
function isMissingRpcError(error: { code?: string; message?: string }): boolean {
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const message = error.message ?? '';
  return (
    new RegExp(COUNT_SUBDOMAINS_RPC, 'i').test(message) &&
    /(could not find|does not exist|not exist|not found)/i.test(message)
  );
}

/**
 * Fallback tanpa RPC: kumpulkan id server yang bisa diakses user — sebagai owner
 * (`servers.owner_id`) maupun sebagai anggota (`server_users.user_id`) — lalu
 * hitung subdomain di server-server tersebut. Id di-union dulu, jadi server yang
 * memenuhi kedua kondisi tetap terhitung sekali (tanpa double count).
 */
async function countUserSubdomainsByQueries(
  service: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
): Promise<number> {
  const [ownedIds, assignedIds] = await Promise.all([
    fetchOwnedServerIds(service, userId),
    fetchAssignedServerIds(service, userId),
  ]);

  // Union tanpa duplikat: id server yang muncul di kedua sumber tetap sekali.
  const seen: Record<string, true> = {};
  const serverIds: string[] = [];
  for (const id of [...ownedIds, ...assignedIds]) {
    if (!seen[id]) {
      seen[id] = true;
      serverIds.push(id);
    }
  }
  if (serverIds.length === 0) return 0;

  let total = 0;
  for (let i = 0; i < serverIds.length; i += SERVER_ID_CHUNK_SIZE) {
    const { count, error } = await service
      .from('server_subdomains')
      .select('id', { count: 'exact', head: true })
      .in('server_id', serverIds.slice(i, i + SERVER_ID_CHUNK_SIZE));
    if (error) throw new Error(error.message);
    total += count ?? 0;
  }
  return total;
}

/** Id server yang dimiliki user langsung (`servers.owner_id = user.id`). */
async function fetchOwnedServerIds(
  service: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += SERVER_ID_PAGE_SIZE) {
    const { data, error } = await service
      .from('servers')
      .select('id')
      .eq('owner_id', userId)
      .range(from, from + SERVER_ID_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ id?: string | null }>;
    ids.push(...rows.map((row) => row?.id).filter((id): id is string => !!id));
    if (rows.length < SERVER_ID_PAGE_SIZE) return ids;
  }
}

/** Id server yang diakses user lewat assignment (`server_users.user_id`). */
async function fetchAssignedServerIds(
  service: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += SERVER_ID_PAGE_SIZE) {
    const { data, error } = await service
      .from('server_users')
      .select('server_id')
      .eq('user_id', userId)
      .range(from, from + SERVER_ID_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ server_id?: string | null }>;
    ids.push(...rows.map((row) => row?.server_id).filter((id): id is string => !!id));
    if (rows.length < SERVER_ID_PAGE_SIZE) return ids;
  }
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
 * Semua user boleh mendaftarkan subdomain untuk server miliknya atau yang ditugaskan kepadanya.
 * Kuota: moderator/user/subuser maks. SUBDOMAIN_QUOTA_PER_USER subdomain
 * (total dari semua server yang ia akses — milik sendiri maupun hasil assignment
 * admin lewat server_users) → 429 bila habis. Owner Panel/Admin tanpa batas.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const result = await checkPermission(user, 'server.read', params.id);
  if (result instanceof Response) return result;
  const server = result.server;

  const denied = await requireSubdomainAccess(user, server);
  if (denied) return denied;

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

  const denied = await requireSubdomainAccess(user, server);
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
