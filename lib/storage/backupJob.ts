import 'server-only';
import crypto from 'node:crypto';
import type {
  BackupLogRow,
  BackupScheduleRow,
  ServerRow,
  StorageProviderRow,
} from '@/types';
import { findOwnerVps } from '@/lib/vps/access';
import { offloadBackupViaVpsNat } from '@/lib/vps/backupOffload';
import { getGDriveBackupFolderId, findGDriveFileId, initGdriveResumableUpload } from '@/lib/storage/gdrive';
import { getValidAccessToken } from '@/lib/storage/tokens';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { createBackupDownloadToken } from '@/lib/wings/jwt';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';
import { computeNextRunAt } from './schedule';
import { buildBackupFileName, sanitizePathSegment, uploadToProvider } from './index';
import { cleanupScheduleRetention } from '@/lib/billing/cleanupRetention';
import { sendNotification } from '@/lib/notifications';

/**
 * Runner job auto backup — dipakai bersama oleh:
 *   - Vercel Cron   (GET /api/cron/backup)
 *   - Manual        (POST /api/servers/{id}/backup-now)
 *   - Admin         (POST /api/admin/backups/run)
 *
 * Alur: catat log → update jadwal → trigger backup ke Wings → tunggu laporan
 * hasil dari Wings (POST /api/remote/backups/{uuid}) → offload transfer GDrive
 * melalui VPS NAT owner bila tersedia (fallback stream via panel) → bersihkan
 * backup di node → enforce retention di cloud.
 */

/** User UUID sistem untuk JWT download saat dipicu cron (tanpa user). */
export const SYSTEM_USER_UUID = '00000000-0000-0000-0000-000000000000';

/** Interval poll status backup di tabel `backups` (wings melaporkan via remote API). */
export const BACKUP_POLL_INTERVAL_MS = 5_000;
/** Batas waktu menunggu wings selesai membuat backup. */
export const BACKUP_POLL_TIMEOUT_MS = 240_000;

export type BackupJobTrigger = 'cron' | 'manual' | 'admin';

export interface BackupJobResult {
  ok: boolean;
  log_id?: string;
  backup_uuid?: string;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Jalankan satu job backup untuk satu jadwal. Tidak pernah melempar error —
 * kegagalan selalu tercermin di backup_logs (status 'failed') dan return value.
 */
export async function runBackupJob(
  schedule: BackupScheduleRow,
  trigger: BackupJobTrigger,
  userId: string | null = null,
): Promise<BackupJobResult> {
  const service = getSupabaseServiceClient();

  const { data: server } = await service
    .from('servers')
    .select('*')
    .eq('id', schedule.server_id)
    .maybeSingle();
  if (!server) throw new Error('Server untuk jadwal backup tidak ditemukan');
  const serverRow = server as ServerRow;

  const { data: provider } = await service
    .from('storage_providers')
    .select('*')
    .eq('id', schedule.storage_provider_id)
    .maybeSingle();
  if (!provider) throw new Error('Storage provider untuk jadwal backup tidak ditemukan');
  const providerRow = provider as StorageProviderRow;
  if (!providerRow.is_active) {
    throw new Error(`Storage provider "${providerRow.name}" sedang nonaktif`);
  }

  // 1. Catat log (status pending).
  const { data: logRow, error: logErr } = await service
    .from('backup_logs')
    .insert({
      server_id: serverRow.id,
      schedule_id: schedule.id,
      storage_provider_id: providerRow.id,
      status: 'pending',
    })
    .select('*')
    .single();
  if (logErr || !logRow) {
    throw new Error(`Gagal mencatat backup log: ${logErr?.message ?? 'unknown'}`);
  }
  const log = logRow as BackupLogRow;

  const finish = async (patch: Partial<BackupLogRow>): Promise<BackupJobResult> => {
    await service.from('backup_logs').update(patch).eq('id', log.id);
    return {
      ok: patch.status === 'done',
      log_id: log.id,
      backup_uuid: log.backup_uuid ?? undefined,
      error: patch.error_message ?? undefined,
    };
  };

  const fail = async (
    message: string,
    patch: Partial<BackupLogRow> = {},
  ): Promise<BackupJobResult> => {
    const result = await finish({
      status: 'failed',
      error_message: message,
      completed_at: new Date().toISOString(),
      ...patch,
    });
    if (serverRow.owner_id) {
      await sendNotification(serverRow.owner_id, 'backup_failed', {
        serverName: serverRow.name,
        serverId: serverRow.id,
        error: message,
        time: new Date(),
      });
    }
    return result;
  };

  try {
    // 2. Update jadwal: last_run_at + next_run_at berikutnya.
    await service
      .from('backup_schedules')
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: computeNextRunAt(
          schedule.interval,
          schedule.time_of_day,
          schedule.day_of_week,
        ).toISOString(),
      })
      .eq('id', schedule.id);

    // 3. Resolve node lalu trigger backup di Wings.
    const resolved = await resolveServerWings(serverRow);
    if (resolved instanceof Response) {
      return await fail('Node untuk server ini tidak tersedia');
    }

    const backupUuid = crypto.randomUUID();
    const fileName = buildBackupFileName(serverRow.name);
    await service.from('backups').insert({
      server_id: serverRow.id,
      uuid: backupUuid,
      name: `Auto backup ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      is_successful: null, // diisi wings saat selesai via /api/remote/backups/{uuid}
    });
    await service
      .from('backup_logs')
      .update({ backup_uuid: backupUuid, status: 'creating' })
      .eq('id', log.id);

    try {
      await resolved.client.createBackup(serverRow.uuid, backupUuid, schedule.ignore_files ?? '');
    } catch (err) {
      return await fail(
        `Gagal memicu backup di node: ${err instanceof Error ? err.message : 'unknown'}`,
        { backup_uuid: backupUuid },
      );
    }

    // 4. Tunggu wings melaporkan hasil backup (is_successful terisi).
    const deadline = Date.now() + BACKUP_POLL_TIMEOUT_MS;
    let wingsBackup: { is_successful: boolean | null; size_bytes: number | null } | null = null;
    while (Date.now() < deadline) {
      await sleep(BACKUP_POLL_INTERVAL_MS);
      const { data } = await service
        .from('backups')
        .select('is_successful, size_bytes')
        .eq('uuid', backupUuid)
        .maybeSingle();
      if (data && data.is_successful !== null) {
        wingsBackup = data as { is_successful: boolean | null; size_bytes: number | null };
        break;
      }
    }
    if (!wingsBackup) {
      return await fail(
        'Timeout menunggu backup selesai dibuat di node (wings tidak melaporkan hasil — pastikan remote API panel sudah terhubung)',
        { backup_uuid: backupUuid },
      );
    }
    if (!wingsBackup.is_successful) {
      return await fail('Wings melaporkan backup gagal dibuat', {
        backup_uuid: backupUuid,
        size_bytes: wingsBackup.size_bytes,
      });
    }

    // 5. Upload ke cloud. Untuk GDrive, transfer besar di-offload ke VPS NAT
    // milik owner server agar stream tidak melewati batas waktu Vercel.
    await service.from('backup_logs').update({ status: 'uploading' }).eq('id', log.id);
    const rawBackupSize = Number(wingsBackup.size_bytes);
    const sizeFromWings =
      Number.isSafeInteger(rawBackupSize) && rawBackupSize >= 0 ? rawBackupSize : undefined;
    let uploadedFileId: string | null = null;
    let uploadedFileName = fileName;
    let uploadedSize = sizeFromWings;
    let offloaded = false;

    const uploadDirectlyThroughPanel = async (): Promise<void> => {
      const download = await resolved.client.downloadBackupStream(
        serverRow.uuid,
        backupUuid,
        schedule.created_by ?? SYSTEM_USER_UUID,
      );
      const reportedSize = Number(download.headers.get('content-length'));
      const size =
        sizeFromWings ??
        (Number.isFinite(reportedSize) && reportedSize >= 0 ? reportedSize : undefined);
      const uploaded = await uploadToProvider(
        providerRow,
        serverRow.name,
        fileName,
        download.body as ReadableStream<Uint8Array>,
        size,
      );
      uploadedFileId = uploaded.fileId;
      uploadedFileName = uploaded.fileName;
      uploadedSize = uploaded.size ?? size ?? uploadedSize;
    };

    if (providerRow.provider === 'gdrive' && serverRow.owner_id && sizeFromWings !== undefined) {
      const ownerVps = await findOwnerVps(serverRow.owner_id);
      if (ownerVps) {
        // Token, signed URL, and resumable session URL remain server-side. The
        // VPS only receives them as quoted curl arguments for the transfer.
        const accessToken = await getValidAccessToken(providerRow);
        const folderId = await getGDriveBackupFolderId(
          accessToken,
          sanitizePathSegment(serverRow.name),
        );
        const wingsToken = createBackupDownloadToken(
          {
            nodeSecret: resolved.client.token,
            serverUuid: serverRow.uuid,
            userUuid: serverRow.owner_id,
          },
          backupUuid,
        );
        const wingsDownloadUrl = resolved.client.downloadBackupUrl(wingsToken);
        const uploadUrl = await initGdriveResumableUpload(
          accessToken,
          fileName,
          folderId,
          sizeFromWings,
        );

        try {
          await offloadBackupViaVpsNat(
            ownerVps,
            wingsDownloadUrl,
            uploadUrl,
            sizeFromWings,
          );
          offloaded = true;
          uploadedSize = sizeFromWings;
          try {
            uploadedFileId = await findGDriveFileId(accessToken, fileName, folderId);
          } catch (lookupError) {
            // The bytes are already safe in GDrive; a missing lookup ID should
            // not turn a successful multi-GB transfer into a failed backup.
            console.warn('[backup] GDrive offload completed but file ID lookup failed', {
              serverId: serverRow.id,
              error: lookupError instanceof Error ? lookupError.message : 'unknown error',
            });
          }
          console.info('[backup] GDrive backup offloaded via owner VPS NAT', {
            serverId: serverRow.id,
            vpsId: ownerVps.id,
            sizeBytes: sizeFromWings,
          });
        } catch (offloadError) {
          console.warn('[backup] VPS NAT offload failed; falling back to panel stream', {
            serverId: serverRow.id,
            vpsId: ownerVps.id,
            error: offloadError instanceof Error ? offloadError.message : 'unknown error',
          });
        }
      } else {
        console.warn('[backup] No owner VPS NAT found; falling back to panel stream', {
          serverId: serverRow.id,
          ownerId: serverRow.owner_id,
        });
      }
    }

    if (!offloaded) {
      await uploadDirectlyThroughPanel();
    }

    // 6. Log done.
    const result = await finish({
      status: 'done',
      completed_at: new Date().toISOString(),
      size_bytes: uploadedSize ?? null,
      storage_file_id: uploadedFileId,
      storage_file_name: uploadedFileName,
      backup_uuid: backupUuid,
    });

    if (serverRow.owner_id) {
      await sendNotification(serverRow.owner_id, 'backup_success', {
        serverName: serverRow.name,
        serverId: serverRow.id,
        time: new Date(),
      });
    }

    // 7. Bersihkan backup di node — sudah tersalin aman ke cloud.
    try {
      await resolved.client.deleteBackup(serverRow.uuid, backupUuid);
    } catch {
      // best-effort — jangan gagalkan job hanya karena cleanup node
    }
    await service.from('backups').delete().eq('uuid', backupUuid);

    await logActivity({
      userId,
      serverId: serverRow.id,
      action: 'backup:auto',
      metadata: {
        trigger,
        backup_uuid: backupUuid,
        log_id: log.id,
        provider: providerRow.provider,
        storage_file_name: uploadedFileName,
      },
    });

    // 8. Retention: hapus backup cloud lama yang melebihi limit. The backup
    // itself is already complete, so a retention/provider outage must not turn
    // a successful backup into a failed backup log.
    try {
      await cleanupScheduleRetention(service, schedule, providerRow);
    } catch {
      // The daily cron runs cleanupRetention independently before backups and
      // will retry this schedule on the next run.
    }

    return result;
  } catch (err) {
    return await fail(err instanceof Error ? err.message : 'Error tidak diketahui');
  }
}
