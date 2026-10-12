import { NextRequest } from 'next/server';
import { decryptToken } from '@/lib/wings/crypto';
import { decodeWingsJwtPayload, verifyWingsJwt } from '@/lib/wings/jwt';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { downloadFromProvider } from '@/lib/storage';
import type { BackupLogRow, NodeRow, ServerRow, StorageProviderRow } from '@/types';

export const runtime = 'nodejs';
// Wings mengunduh SELURUH arsip backup dari sini — harus sama dengan
// maxDuration route cloud restore (app/api/servers/[id]/backup-schedule/cloud-restore).
export const maxDuration = 300;

/**
 * GET /api/remote/backup-restore/{logId}?token=...
 *
 * Endpoint streaming SIGNED untuk Cloud Restore. Saat route
 * `POST /api/servers/[id]/backup-schedule/cloud-restore` memanggil
 * `POST /api/servers/{uuid}/backup/{uuid}/restore` di Wings dengan body
 * `{ adapter: "s3", download_url }`, Wings mengunduh arsip backup dari URL
 * ini (panel mem-proxy dari cloud storage, tanpa buffer ke disk/memory).
 *
 * Autentikasi: JWT HS256 (secret = token node, TTL 15 menit) di query
 * string — HTTP client restore wings TIDAK mengirim header Authorization
 * (lihat backupRestoreHttpClient di wings router_server_backup.go), jadi
 * token harus berada di URL. Pola yang sama dengan
 * `/download/backup?token=...` milik wings sendiri.
 *
 * Catatan Content-Type: wings memeriksa header response
 * `application/x-gzip`/`application/gzip` (isSupportedBackupRestoreContentType),
 * sedangkan ekstraksi aktual memakai mholt/archives `format.Extract` yang
 * auto-detect format arsip. Backup panel selalu `.tar.gz`
 * (buildBackupFileName), jadi header x-gzip di bawah selalu jujur.
 *
 * Kegagalan di sini dilaporkan Wings ke route cloud restore sebagai
 * respons 400 (status download URL tidak 200 / body tidak valid).
 */
export async function GET(request: NextRequest, { params }: { params: { logId: string } }) {
  const token = request.nextUrl.searchParams.get('token') ?? '';

  // 1. Decode payload (tanpa verifikasi) untuk menemukan token node mana
  //    yang dipakai menandatangani token ini. Diproses SEBELUM menyentuh
  //    database supaya token tidak valid langsung 401.
  const pre = decodeWingsJwtPayload(token);
  const nodeId = typeof pre?.node_id === 'string' ? pre.node_id : '';
  const tokenLogId = typeof pre?.backup_log_id === 'string' ? pre.backup_log_id : '';
  if (!nodeId || !tokenLogId || tokenLogId !== params.logId) {
    return Response.json({ error: 'Token tidak valid' }, { status: 401 });
  }

  const service = getSupabaseServiceClient();

  // 2. Verifikasi signature dengan token node (plaintext) + exp/iat.
  const { data: nodeData } = await service.from('nodes').select('*').eq('id', nodeId).maybeSingle();
  const nodeRow = nodeData as NodeRow | null;
  if (!nodeRow) {
    return Response.json({ error: 'Node tidak ditemukan' }, { status: 404 });
  }
  let nodeToken: string;
  try {
    nodeToken = decryptToken(nodeRow.token_encrypted);
  } catch {
    return Response.json({ error: 'Token node tidak valid' }, { status: 401 });
  }
  const claims = verifyWingsJwt(token, nodeToken);
  if (!claims) {
    return Response.json({ error: 'Token tidak valid' }, { status: 401 });
  }

  // 3. Cegah akses lintas-server: server pada token harus dimiliki node ini
  //    dan log backup harus milik server tersebut.
  const serverUuid = typeof claims.server_uuid === 'string' ? claims.server_uuid : '';
  const { data: serverData } = await service
    .from('servers')
    .select('*')
    .eq('uuid', serverUuid)
    .eq('node_id', nodeRow.id)
    .maybeSingle();
  const serverRow = serverData as ServerRow | null;
  if (!serverRow) {
    return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });
  }

  const { data: logData } = await service
    .from('backup_logs')
    .select('*')
    .eq('id', params.logId)
    .eq('server_id', serverRow.id)
    .maybeSingle();
  const log = logData as BackupLogRow | null;
  if (!log || log.status !== 'done' || !log.storage_file_id) {
    return Response.json({ error: 'Log backup tidak valid' }, { status: 404 });
  }

  // 4. Resolve storage provider (logika sama dengan route cloud restore:
  //    provider pada log, fallback ke schedule server).
  let providerId = log.storage_provider_id;
  if (!providerId) {
    const { data: sched } = await service
      .from('backup_schedules')
      .select('storage_provider_id')
      .eq('server_id', serverRow.id)
      .maybeSingle();
    providerId = (sched as { storage_provider_id?: string } | null)?.storage_provider_id ?? null;
  }
  if (!providerId) {
    return Response.json(
      { error: 'Storage provider untuk backup ini tidak ditemukan' },
      { status: 404 },
    );
  }

  const { data: providerData } = await service
    .from('storage_providers')
    .select('*')
    .eq('id', providerId)
    .maybeSingle();
  const providerRow = providerData as StorageProviderRow | null;
  if (!providerRow) {
    return Response.json(
      { error: 'Storage provider tidak ditemukan atau sudah dihapus' },
      { status: 404 },
    );
  }
  if (!providerRow.is_active) {
    return Response.json(
      { error: `Storage provider "${providerRow.name}" sedang nonaktif` },
      { status: 400 },
    );
  }

  // 5. Stream file dari cloud storage (tanpa buffer ke disk/memory).
  try {
    const download = await downloadFromProvider(providerRow, log.storage_file_id);
    const headers = new Headers({
      'Content-Type': 'application/x-gzip',
      'Cache-Control': 'no-store',
    });
    if (download.size != null && download.size > 0) {
      headers.set('Content-Length', String(download.size));
    }
    return new Response(download.stream, { status: 200, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal mengunduh file dari cloud storage';
    return Response.json({ error: message }, { status: 502 });
  }
}
