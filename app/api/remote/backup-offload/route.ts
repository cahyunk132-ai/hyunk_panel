import { NextRequest } from 'next/server';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { verifyBackupOffloadToken } from '@/lib/vps/backupOffload';
import { getValidAccessToken } from '@/lib/storage/tokens';
import { findGDriveFileId } from '@/lib/storage/gdrive';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';
import { cleanupScheduleRetention } from '@/lib/billing/cleanupRetention';
import { sendNotification } from '@/lib/notifications';
import type { BackupLogRow, BackupScheduleRow, ServerRow, StorageProviderRow } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/remote/backup-offload
 *
 * Callback webhook dipanggil oleh background script di VPS Relay setelah
 * transfer curl selesai mengunggah file backup ke cloud storage.
 * Autentikasi: HMAC token yang ditandatangani oleh panel saat mendispatch job.
 */
export async function POST(request: NextRequest) {
  let body: { token?: string; http_code?: string; exit_code?: number; error?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body JSON tidak valid' }, { status: 400 });
  }

  const token = typeof body?.token === 'string' ? body.token : '';
  if (!token) {
    return Response.json({ error: 'Token wajib diisi' }, { status: 400 });
  }

  const claims = verifyBackupOffloadToken(token);
  if (!claims) {
    return Response.json({ error: 'Token tidak valid atau kedaluwarsa' }, { status: 401 });
  }

  const {
    log_id,
    server_id,
    server_uuid,
    backup_uuid,
    schedule_id,
    provider_id,
    file_name,
    folder_id,
    size_bytes,
    owner_id,
    user_id,
    trigger,
  } = claims;

  const service = getSupabaseServiceClient();

  // 1. Ambil log saat ini
  const { data: logData } = await service
    .from('backup_logs')
    .select('*')
    .eq('id', log_id)
    .maybeSingle();

  const log = logData as BackupLogRow | null;
  if (!log) {
    return Response.json({ error: 'Log backup tidak ditemukan' }, { status: 404 });
  }

  // Idempotency: jika sudah 'done', jangan diproses ulang
  if (log.status === 'done') {
    return Response.json({ ok: true, message: 'Backup sudah berstatus done' });
  }

  const httpCode = String(body.http_code ?? '').trim();
  const exitCode = typeof body.exit_code === 'number' ? body.exit_code : -1;
  const isSuccess = (httpCode === '200' || httpCode === '201') && exitCode === 0;

  // Resolve server & node Wings untuk cleanup arsip
  const { data: serverData } = await service
    .from('servers')
    .select('*')
    .eq('id', server_id)
    .maybeSingle();
  const serverRow = serverData as ServerRow | null;

  if (isSuccess) {
    // 2. Cari file ID di Google Drive
    let uploadedFileId: string | null = null;
    try {
      const { data: providerData } = await service
        .from('storage_providers')
        .select('*')
        .eq('id', provider_id)
        .maybeSingle();
      if (providerData) {
        const accessToken = await getValidAccessToken(providerData as StorageProviderRow);
        uploadedFileId = await findGDriveFileId(accessToken, file_name, folder_id);
      }
    } catch (lookupErr) {
      console.warn('[backup-offload] GDrive file ID lookup error:', lookupErr);
    }

    // 3. Update log jadi done
    await service
      .from('backup_logs')
      .update({
        status: 'done',
        completed_at: new Date().toISOString(),
        size_bytes: size_bytes,
        storage_file_id: uploadedFileId,
        storage_file_name: file_name,
        error_message: null,
      })
      .eq('id', log_id);

    // 4. Hapus arsip backup di Wings node agar disk node tidak penuh
    if (serverRow) {
      try {
        const resolved = await resolveServerWings(serverRow);
        if (!(resolved instanceof Response)) {
          await resolved.client.deleteBackup(server_uuid, backup_uuid).catch(() => undefined);
        }
      } catch (nodeErr) {
        console.warn('[backup-offload] Gagal membersihkan backup di Wings node:', nodeErr);
      }
    }
    await service.from('backups').delete().eq('uuid', backup_uuid);

    // 5. Retention cleanup
    if (schedule_id) {
      try {
        const [{ data: sched }, { data: prov }] = await Promise.all([
          service.from('backup_schedules').select('*').eq('id', schedule_id).maybeSingle(),
          service.from('storage_providers').select('*').eq('id', provider_id).maybeSingle(),
        ]);
        if (sched && prov) {
          await cleanupScheduleRetention(
            service,
            sched as BackupScheduleRow,
            prov as StorageProviderRow,
          );
        }
      } catch (retentionErr) {
        console.warn('[backup-offload] Retention cleanup error:', retentionErr);
      }
    }

    // 6. Activity log
    await logActivity({
      userId: user_id,
      serverId: server_id,
      action: 'backup:auto',
      metadata: {
        trigger,
        backup_uuid,
        log_id,
        storage_file_name: file_name,
        offloaded: true,
      },
    });

    // 7. Notifikasi sukses
    if (owner_id && serverRow) {
      await sendNotification(owner_id, 'backup_success', {
        serverName: serverRow.name,
        serverId: server_id,
        time: new Date(),
      }).catch(() => undefined);
    }

    console.info('[backup-offload] Offloaded backup completed successfully', {
      logId: log_id,
      serverId: server_id,
      sizeBytes: size_bytes,
    });

    return Response.json({ ok: true, log_id });
  } else {
    const errorDetail = typeof body?.error === 'string' && body.error.trim() ? `: ${body.error.trim()}` : '';
    const errorMsg = `Transfer via VPS Relay gagal (HTTP ${httpCode || 'unknown'}, exit code ${exitCode})${errorDetail}`;
    await service
      .from('backup_logs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: errorMsg,
      })
      .eq('id', log_id);

    // Hapus sisa backup di node
    if (serverRow) {
      try {
        const resolved = await resolveServerWings(serverRow);
        if (!(resolved instanceof Response)) {
          await resolved.client.deleteBackup(server_uuid, backup_uuid).catch(() => undefined);
        }
      } catch {
        // best effort
      }
    }
    await service.from('backups').delete().eq('uuid', backup_uuid);

    // Notifikasi gagal
    if (owner_id && serverRow) {
      await sendNotification(owner_id, 'backup_failed', {
        serverName: serverRow.name,
        serverId: server_id,
        error: errorMsg,
        time: new Date(),
      }).catch(() => undefined);
    }

    console.warn('[backup-offload] Offloaded backup failed', {
      logId: log_id,
      httpCode,
      exitCode,
    });

    return Response.json({ ok: false, error: errorMsg }, { status: 400 });
  }
}
