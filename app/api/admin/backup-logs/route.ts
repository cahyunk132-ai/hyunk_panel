import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { isStorageProviderType } from '@/lib/storage/provider-meta';
import { cleanupStaleBackupLogs } from '@/lib/storage/backupJob';
import { resolveServerWings } from '@/lib/wings/resolve';
import { BACKUP_LOG_PAGE_SIZE } from '@/lib/utils/constants';
import type {
  AdminBackupLogRow,
  AdminBackupStats,
  BackupLogStatus,
  BackupStatusFilter,
  ServerRow,
  StorageProviderType,
} from '@/types';

export const runtime = 'nodejs';

const LOG_COLUMNS =
  'id, server_id, schedule_id, backup_uuid, storage_provider_id, storage_file_id, storage_file_name, size_bytes, status, error_message, started_at, completed_at';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_FILTERS: BackupStatusFilter[] = ['all', 'pending', 'running', 'done', 'failed'];

// ─── Cache ringan untuk sum total storage ────────────────────────────────────
// Sum seluruh size_bytes butuh beberapa request (PostgREST tidak punya agregat
// bawaan). Cache per-instance ini menghindari hit berulang saat auto-refresh.
const STORAGE_SUM_TTL_MS = 60_000;
const STORAGE_SUM_PAGE = 1000;
const STORAGE_SUM_MAX_ROWS = 50_000;
let storageSumCache: { count: number; total: number; approximate: boolean; at: number } | null = null;

/**
 * GET /api/admin/backup-logs — monitoring semua backup log di seluruh panel
 * (Owner Panel & Admin). Query memakai SERVICE ROLE (bypass RLS) dan join ke
 * `servers` (nama server + owner) serta `users` (email owner).
 *
 * Query params:
 *   status   = all | pending | running | done | failed   (default all)
 *   provider = all | gdrive | dropbox | onedrive | s3 | sftp | webdav
 *   from,to  = YYYY-MM-DD (berdasarkan started_at)
 *   q        = cari nama server / email owner / username owner
 *   sort     = desc | asc  (default desc = terbaru)
 *   page     = nomor halaman, mulai 1
 *   statsFrom, statsTo = ISO datetime untuk rentang kartu "hari ini"
 */
export async function GET(request: NextRequest) {
  const user = await requireAdmin();
  if (user instanceof Response) return user;

  const params = request.nextUrl.searchParams;
  const service = getSupabaseServiceClient();

  // Auto-recovery: bersihkan log backup yang macet (zombie) >15 menit
  await cleanupStaleBackupLogs().catch(() => undefined);

  // ── Filter ────────────────────────────────────────────────────────────────
  const statusParam = (params.get('status') ?? 'all') as BackupStatusFilter;
  const status: BackupStatusFilter = STATUS_FILTERS.includes(statusParam) ? statusParam : 'all';

  const providerParam = params.get('provider') ?? 'all';
  const provider: StorageProviderType | 'all' = isStorageProviderType(providerParam)
    ? providerParam
    : 'all';

  const fromParam = params.get('from') ?? '';
  const toParam = params.get('to') ?? '';
  const from = DATE_RE.test(fromParam) ? fromParam : '';
  const to = DATE_RE.test(toParam) ? toParam : '';

  const q = (params.get('q') ?? '').trim();
  const sort = params.get('sort') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(parseInt(params.get('page') ?? '1', 10) || 1, 1);

  // ── Query utama ───────────────────────────────────────────────────────────
  // storage_providers di-!inner hanya saat filter provider aktif supaya baris
  // tanpa provider tetap muncul di tampilan default.
  const providerEmbed = provider === 'all' ? 'storage_providers(id, name, provider)' : 'storage_providers!inner(id, name, provider)';

  let query = service
    .from('backup_logs')
    .select(`${LOG_COLUMNS}, servers!inner(id, name, uuid, owner_id), ${providerEmbed}`, {
      count: 'exact',
    })
    .order('started_at', { ascending: sort === 'asc' });

  if (status === 'running') query = query.in('status', ['creating', 'uploading']);
  else if (status === 'pending') query = query.eq('status', 'pending');
  else if (status === 'done') query = query.eq('status', 'done');
  else if (status === 'failed') query = query.eq('status', 'failed');

  if (provider !== 'all') query = query.eq('storage_providers.provider', provider);
  if (from) query = query.gte('started_at', `${from}T00:00:00.000Z`);
  if (to) query = query.lte('started_at', `${to}T23:59:59.999Z`);

  // Search: resolve dulu server yang cocok (nama server ATAU email/username owner),
  // lalu filter backup_logs berdasarkan server_id.
  if (q) {
    const serverIds = await resolveServerIds(service, q);
    if (serverIds.length === 0) {
      return Response.json({
        logs: [],
        total: 0,
        page: 1,
        page_size: BACKUP_LOG_PAGE_SIZE,
        total_pages: 1,
        stats: await buildStats(service, params.get('statsFrom'), params.get('statsTo')),
      });
    }
    query = query.in('server_id', serverIds);
  }

  const { data, count, error } = await query.range(
    (page - 1) * BACKUP_LOG_PAGE_SIZE,
    page * BACKUP_LOG_PAGE_SIZE - 1,
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });

  type JoinedRow = {
    id: string;
    server_id: string;
    schedule_id: string | null;
    backup_uuid: string | null;
    storage_provider_id: string | null;
    storage_file_id: string | null;
    storage_file_name: string | null;
    size_bytes: number | null;
    status: BackupLogStatus | null;
    error_message: string | null;
    started_at: string;
    completed_at: string | null;
    servers: { id: string; name: string; uuid: string; owner_id: string | null } | null;
    storage_providers: { id: string; name: string; provider: StorageProviderType } | null;
  };

  const rows = (data ?? []) as unknown as JoinedRow[];

  // ── Lookup owner (tabel users) ────────────────────────────────────────────
  const ownerIds = Array.from(
    new Set(rows.map((row) => row.servers?.owner_id).filter(Boolean) as string[]),
  );
  const ownersById: Record<string, { email: string | null; username: string }> = {};
  if (ownerIds.length > 0) {
    const { data: owners } = await service.from('users').select('id, username, email').in('id', ownerIds);
    for (const owner of (owners ?? []) as Array<{ id: string; username: string; email: string | null }>) {
      ownersById[owner.id] = { email: owner.email, username: owner.username };
    }
  }

  const logs: AdminBackupLogRow[] = rows.map((row) => ({
    id: row.id,
    server_id: row.server_id,
    schedule_id: row.schedule_id,
    backup_uuid: row.backup_uuid,
    storage_provider_id: row.storage_provider_id,
    storage_file_id: row.storage_file_id,
    storage_file_name: row.storage_file_name,
    size_bytes: row.size_bytes,
    status: row.status,
    error_message: row.error_message,
    started_at: row.started_at,
    completed_at: row.completed_at,
    server_name: row.servers?.name ?? null,
    server_uuid: row.servers?.uuid ?? null,
    owner_id: row.servers?.owner_id ?? null,
    owner_email: row.servers?.owner_id ? ownersById[row.servers.owner_id]?.email ?? null : null,
    owner_username: row.servers?.owner_id ? ownersById[row.servers.owner_id]?.username ?? null : null,
    provider_name: row.storage_providers?.name ?? null,
    provider_type: row.storage_providers?.provider ?? null,
  }));

  return Response.json({
    logs,
    total: count ?? 0,
    page,
    page_size: BACKUP_LOG_PAGE_SIZE,
    total_pages: Math.max(Math.ceil((count ?? 0) / BACKUP_LOG_PAGE_SIZE), 1),
    stats: await buildStats(service, params.get('statsFrom'), params.get('statsTo')),
  });
}

/**
 * Cari server berdasarkan nama server, email owner, atau username owner.
 * Dipisah dari query utama supaya filter PostgREST tidak perlu nested !inner
 * dua level (servers → users).
 */
async function resolveServerIds(service: SupabaseClient, rawQuery: string): Promise<string[]> {
  // Karakter ini punya arti khusus di sintaks filter PostgREST (or/ilike) —
  // dibuang supaya input user tidak bisa merusak query.
  const q = rawQuery.replace(/[,()%*"'\\]/g, ' ').trim().slice(0, 100);
  if (!q) return [];
  const term = `%${q}%`;
  const ids = new Set<string>();

  const { data: byName } = await service
    .from('servers')
    .select('id')
    .ilike('name', term)
    .limit(1000);
  for (const row of (byName ?? []) as Array<{ id: string }>) ids.add(row.id);

  const { data: owners } = await service
    .from('users')
    .select('id')
    .or(`email.ilike.${term},username.ilike.${term}`)
    .limit(1000);
  const ownerIds = (owners ?? []).map((row) => (row as { id: string }).id);
  if (ownerIds.length > 0) {
    const { data: byOwner } = await service
      .from('servers')
      .select('id')
      .in('owner_id', ownerIds)
      .limit(1000);
    for (const row of (byOwner ?? []) as Array<{ id: string }>) ids.add(row.id);
  }

  return Array.from(ids);
}

/** Kartu statistik header: backup hari ini, storage terpakai, jadwal aktif. */
async function buildStats(
  service: SupabaseClient,
  statsFrom: string | null,
  statsTo: string | null,
): Promise<AdminBackupStats> {
  const now = new Date();
  const rangeFrom = parseIsoOr(statsFrom, startOfUtcDay(now));
  const rangeTo = parseIsoOr(statsTo, endOfUtcDay(now));

  const [totalToday, successToday, failedToday, activeSchedules, storage] = await Promise.all([
    countLogs(service, rangeFrom, rangeTo),
    countLogs(service, rangeFrom, rangeTo, 'done'),
    countLogs(service, rangeFrom, rangeTo, 'failed'),
    countActiveSchedules(service),
    sumAllBackupBytes(service),
  ]);

  return {
    total_today: totalToday,
    success_today: successToday,
    failed_today: failedToday,
    total_storage_bytes: storage.total,
    storage_approximate: storage.approximate,
    active_schedules: activeSchedules,
    range_from: rangeFrom.toISOString(),
    range_to: rangeTo.toISOString(),
  };
}

async function countLogs(
  service: SupabaseClient,
  from: Date,
  to: Date,
  status?: BackupLogStatus,
): Promise<number> {
  let query = service
    .from('backup_logs')
    .select('id', { count: 'exact', head: true })
    .gte('started_at', from.toISOString())
    .lte('started_at', to.toISOString());
  if (status) query = query.eq('status', status);
  const { count } = await query;
  return count ?? 0;
}

async function countActiveSchedules(service: SupabaseClient): Promise<number> {
  const { count } = await service
    .from('backup_schedules')
    .select('id', { count: 'exact', head: true })
    .eq('is_enabled', true);
  return count ?? 0;
}

/**
 * Total ukuran semua file backup (seluruh waktu). Di-cache 60 detik per instance
 * dan dihitung ulang hanya bila jumlah baris berubah.
 */
async function sumAllBackupBytes(
  service: SupabaseClient,
): Promise<{ total: number; approximate: boolean }> {
  const { count } = await service.from('backup_logs').select('id', { count: 'exact', head: true });
  const total = count ?? 0;

  if (
    storageSumCache &&
    storageSumCache.count === total &&
    Date.now() - storageSumCache.at < STORAGE_SUM_TTL_MS
  ) {
    return { total: storageSumCache.total, approximate: storageSumCache.approximate };
  }

  let sum = 0;
  let approximate = false;
  const limit = Math.min(total, STORAGE_SUM_MAX_ROWS);
  for (let offset = 0; offset < limit; offset += STORAGE_SUM_PAGE) {
    const { data, error } = await service
      .from('backup_logs')
      .select('size_bytes')
      .range(offset, offset + STORAGE_SUM_PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as Array<{ size_bytes: number | null }>;
    for (const row of rows) sum += Number(row.size_bytes) || 0;
    if (rows.length < STORAGE_SUM_PAGE) break;
  }
  if (total > STORAGE_SUM_MAX_ROWS) approximate = true;

  storageSumCache = { count: total, total: sum, approximate, at: Date.now() };
  return { total: sum, approximate };
}

function parseIsoOr(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

/**
 * POST /api/admin/backup-logs — aksi admin pada log backup:
 * - action = 'cleanup_stale': jalankan pembersihan log zombie secara manual
 * - action = 'mark_failed': tandai satu log tertentu sebagai failed
 */
export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => ({}))) as {
    action?: 'cleanup_stale' | 'mark_failed';
    log_id?: string;
  };

  if (body.action === 'mark_failed' && body.log_id) {
    const service = getSupabaseServiceClient();
    const { data: log } = await service
      .from('backup_logs')
      .select('id, server_id, backup_uuid, status')
      .eq('id', body.log_id)
      .maybeSingle();

    if (!log) {
      return Response.json({ error: 'Log tidak ditemukan' }, { status: 404 });
    }

    if (log.backup_uuid && log.server_id) {
      try {
        const { data: server } = await service
          .from('servers')
          .select('*')
          .eq('id', log.server_id)
          .maybeSingle();
        if (server) {
          const resolved = await resolveServerWings(server as ServerRow);
          if (!(resolved instanceof Response)) {
            await resolved.client.deleteBackup(server.uuid, log.backup_uuid).catch(() => undefined);
          }
        }
        await service.from('backups').delete().eq('uuid', log.backup_uuid);
      } catch {
        // best effort
      }
    }

    await service
      .from('backup_logs')
      .update({
        status: 'failed',
        error_message: 'Dibatalkan oleh administrator panel',
        completed_at: new Date().toISOString(),
      })
      .eq('id', log.id);

    return Response.json({ ok: true, message: 'Log berhasil ditandai sebagai failed' });
  }

  const result = await cleanupStaleBackupLogs();
  return Response.json({ ok: true, ...result });
}
