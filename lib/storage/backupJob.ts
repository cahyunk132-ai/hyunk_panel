import 'server-only';
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BackupLogRow,
  BackupScheduleRow,
  ServerRow,
  StorageProviderRow,
} from '@/types';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';
import { computeNextRunAt } from './schedule';
import { buildBackupFileName, uploadToProvider, deleteFromProvider } from './index';

/**
 * Runner job auto backup — dipakai bersama oleh:
 *   - Vercel Cron   (GET /api/cron/backup)
 *   - Manual        (POST /api/servers/{id}/backup-now)
 *   - Admin         (POST /api/admin/backups/run)
 *
 * Alur: catat log → update jadwal → trigger backup ke Wings → tunggu laporan
 * hasil dari Wings (POST /api/remote/backups/{uuid}) → download streaming dari
 * node → upload streaming ke cloud storage → bersihkan backup di node →
 * enforce retention di cloud.
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

/** Enforce retention: hapus backup cloud yang melebihi limit (terlama dulu). */
async function enforceRetention(
  service: SupabaseClient,
  schedule: BackupScheduleRow,
  provider: StorageProviderRow,
): Promise<void> {
  const retention = schedule.retention ?? 5;
  if (retention < 1) return;

  const { data: logs } = await service
    .from('backup_logs')
    .select('id, storage_file_id, storage_file_name')
    .eq('schedule_id', schedule.id)
    .eq('status', 'done')
    .order('started_at', { ascending: false });

  const excess = (logs ?? []).slice(retention);
  for (const old of excess) {
    // Hapus file di cloud (best-effort) lalu hapus log-nya.
    if (old.storage_file_id) {
      try {
        await deleteFromProvider(provider, old.storage_file_id as string);
      } catch {
        // sengaja ditelan — retention tetap lanjut ke log berikutnya
      }
    }
    await service.from('backup_logs').delete().eq('id', old.id);
  }
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
  ): Promise<BackupJobResult> =>
    finish({
      status: 'failed',
      error_message: message,
      completed_at: new Date().toISOString(),
      ...patch,
    });

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

    // 5. Download streaming dari Wings → upload streaming ke cloud storage.
    await service.from('backup_logs').update({ status: 'uploading' }).eq('id', log.id);
    const download = await resolved.client.downloadBackupStream(
      serverRow.uuid,
      backupUuid,
      schedule.created_by ?? SYSTEM_USER_UUID,
    );
    const reportedSize = Number(download.headers.get('content-length'));
    const size =
      wingsBackup.size_bytes ??
      (Number.isFinite(reportedSize) && reportedSize > 0 ? reportedSize : undefined);

    const uploaded = await uploadToProvider(
      providerRow,
      serverRow.name,
      fileName,
      download.body as ReadableStream<Uint8Array>,
      size,
    );

    // 6. Log done.
    const result = await finish({
      status: 'done',
      completed_at: new Date().toISOString(),
      size_bytes: wingsBackup.size_bytes ?? uploaded.size ?? null,
      storage_file_id: uploaded.fileId,
      storage_file_name: uploaded.fileName,
      backup_uuid: backupUuid,
    });

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
        storage_file_name: uploaded.fileName,
      },
    });

    // 8. Retention: hapus backup cloud lama yang melebihi limit.
    await enforceRetention(service, schedule, providerRow);

    return result;
  } catch (err) {
    return await fail(err instanceof Error ? err.message : 'Error tidak diketahui');
  }
}
