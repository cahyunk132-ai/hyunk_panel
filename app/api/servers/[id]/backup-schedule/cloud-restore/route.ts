import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';
import { createBackupRestoreStreamToken } from '@/lib/wings/jwt';
import type { BackupLogRow, StorageProviderRow } from '@/types';

export const runtime = 'nodejs';
// Restore dari cloud bisa berjalan lama untuk file backup besar.
export const maxDuration = 300;

interface CloudRestoreBody {
  log_id?: string;
  backup_log_id?: string;
  logId?: string;
  backupLogId?: string;
  id?: string;
  truncate?: boolean;
  truncate_files?: boolean;
  truncateFiles?: boolean;
}

/**
 * POST /api/servers/[id]/backup-schedule/cloud-restore
 *
 * Restore server langsung dari file backup yang tersimpan di cloud storage
 * (GDrive, Dropbox, S3, SFTP, WebDAV) tanpa perlu download manual ke disk:
 *   1. Buat URL signed (JWT, secret = token node) di panel untuk wings
 *      mengunduh arsip: GET /api/remote/backup-restore/{logId}?token=...
 *      (panel mem-proxy stream dari cloud storage)
 *   2. Pre-flight: pastikan file masih ada di cloud storage SEBELUM
 *      meminta restore — request restore menghentikan server, sehingga
 *      file hilang harus gagal sebelum server berhenti
 *   3. Trigger restore: POST /api/servers/{uuid}/backup/{uuid}/restore di
 *      Wings dengan { adapter: "s3", download_url, truncate_directory }.
 *      Wings sendiri yang mengunduh arsip (TIDAK lewat /upload/file, jadi
 *      tidak kena api.upload_limit 100 MB), truncate bila diminta,
 *      extract arsip, dan tidak meninggalkan file sementara di node
 *   4. Catat di audit log (activity_logs)
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'backup.restore', params.id);
  if (checked instanceof Response) return checked;

  const body = (await request.json().catch(() => ({}))) as CloudRestoreBody;
  const rawLogId =
    body.log_id ?? body.backup_log_id ?? body.logId ?? body.backupLogId ?? body.id;
  const logId = typeof rawLogId === 'string' ? rawLogId.trim() : '';
  const truncate = Boolean(
    body.truncate ?? body.truncate_files ?? body.truncateFiles ?? false,
  );

  const service = getSupabaseServiceClient();

  let logData: BackupLogRow | null = null;
  if (logId) {
    const { data, error } = await service
      .from('backup_logs')
      .select('*')
      .eq('id', logId)
      .eq('server_id', checked.server.id)
      .maybeSingle();
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    logData = (data as BackupLogRow | null) ?? null;
  } else {
    const { data, error } = await service
      .from('backup_logs')
      .select('*')
      .eq('server_id', checked.server.id)
      .eq('status', 'done')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    logData = (data as BackupLogRow | null) ?? null;
  }

  if (!logData) {
    return Response.json({ error: 'Log backup cloud tidak ditemukan' }, { status: 404 });
  }
  if (logData.status !== 'done') {
    return Response.json(
      { error: 'Hanya backup dengan status done yang dapat direstore dari cloud' },
      { status: 400 },
    );
  }
  if (!logData.storage_file_id) {
    return Response.json(
      { error: 'File backup di cloud storage tidak ditemukan pada log ini' },
      { status: 400 },
    );
  }

  let providerId = logData.storage_provider_id;
  if (!providerId) {
    const { data: sched } = await service
      .from('backup_schedules')
      .select('storage_provider_id')
      .eq('server_id', checked.server.id)
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
  if (!providerData) {
    return Response.json(
      { error: 'Storage provider tidak ditemukan atau sudah dihapus' },
      { status: 404 },
    );
  }
  const providerRow = providerData as StorageProviderRow;
  if (!providerRow.is_active) {
    return Response.json(
      { error: `Storage provider "${providerRow.name}" sedang nonaktif` },
      { status: 400 },
    );
  }

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  // Identifier restore di Wings. Hanya dipakai di endpoint restore dan
  // notifikasi status — restore adapter "s3" tidak membuat file backup
  // nyata di node, jadi tidak ada yang perlu dihapus setelahnya.
  const tempBackupUuid = crypto.randomUUID();

  // URL signed (JWT, secret = token node, TTL 15 menit) yang dipakai Wings
  // untuk mengunduh arsip langsung dari panel.
  const streamToken = createBackupRestoreStreamToken(
    {
      nodeSecret: resolved.client.token,
      nodeId: resolved.node.id,
      serverUuid: resolved.server.uuid,
      userUuid: user.id,
    },
    logData.id,
  );
  const restoreStreamUrl =
    `${request.nextUrl.origin}/api/remote/backup-restore/${encodeURIComponent(logData.id)}` +
    `?token=${encodeURIComponent(streamToken)}`;

  try {
    // 1. Pre-flight: pastikan file masih ada di cloud storage SEBELUM
    //    meminta restore — request restore menghentikan server, sehingga
    //    file hilang harus gagal tanpa menghentikan server. Cukup cek
    //    header respons; body dibatalkan segera.
    const preflight = await fetch(restoreStreamUrl, { cache: 'no-store' });
    if (!preflight.ok) {
      const errText = await preflight.text().catch(() => '');
      throw new Error(
        `Verifikasi file di cloud storage gagal → ${preflight.status}: ${errText.slice(0, 300)}`,
      );
    }
    await preflight.body?.cancel().catch(() => undefined);

    // 2. Trigger restore. Wings sendiri yang mengunduh arsip dari
    //    restoreStreamUrl (tidak lewat POST /upload/file, jadi tidak kena
    //    api.upload_limit 100 MB), menghentikan server, truncate bila
    //    diminta, extract arsip, dan tidak meninggalkan file sementara di
    //    node. Berjalan asinkron di Wings (respons 202).
    await resolved.client.restoreBackupFromUrl(
      resolved.server.uuid,
      tempBackupUuid,
      restoreStreamUrl,
      truncate,
    );

    // 3. Catat di audit log.
    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'backup:cloud-restore',
      metadata: {
        log_id: logData.id,
        backup_uuid: logData.backup_uuid,
        provider: providerRow.provider,
        provider_name: providerRow.name,
        storage_file_id: logData.storage_file_id,
        storage_file_name: logData.storage_file_name,
        truncate,
      },
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });

    return Response.json({
      ok: true,
      success: true,
      log_id: logData.id,
      storage_file_name: logData.storage_file_name,
      provider: providerRow.provider,
      truncate,
    });
  } catch (err) {
    // Tidak ada file sementara di node yang perlu dibersihkan (restore
    // adapter "s3" men-stream arsip langsung ke proses restore di Wings).
    const message =
      err instanceof Error ? err.message : 'Gagal melakukan restore backup dari cloud';

    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'backup:cloud-restore-failed',
      metadata: {
        log_id: logData.id,
        backup_uuid: logData.backup_uuid,
        provider: providerRow.provider,
        storage_file_name: logData.storage_file_name,
        truncate,
        error: message,
      },
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });

    return Response.json({ error: message }, { status: 502 });
  }
}
