import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { deleteFromProvider } from '@/lib/storage';
import type { BackupScheduleRow, StorageProviderRow } from '@/types';

interface RetentionLog {
  id: string;
  server_id: string;
  schedule_id: string | null;
  storage_provider_id: string | null;
  storage_file_id: string | null;
  storage_file_name: string | null;
  started_at: string;
}

export interface CleanupRetentionResult {
  schedules: number;
  deleted: number;
  skipped: number;
  failed: number;
  results: Array<Record<string, unknown>>;
}

/**
 * Enforce retention for one schedule. Cloud backup metadata is stored in
 * `backup_logs` (the `backups` table only tracks temporary Wings backups), so
 * this removes the cloud file and its completed log together.
 */
export async function cleanupScheduleRetention(
  service: SupabaseClient,
  schedule: BackupScheduleRow,
  provider: StorageProviderRow,
): Promise<{ deleted: number; skipped: number; failed: number; errors: string[] }> {
  const retention = Number(schedule.retention ?? 0);
  if (!Number.isFinite(retention) || retention <= 0) {
    return { deleted: 0, skipped: 0, failed: 0, errors: [] };
  }

  const { data, error } = await service
    .from('backup_logs')
    .select('id, server_id, schedule_id, storage_provider_id, storage_file_id, storage_file_name, started_at')
    .eq('schedule_id', schedule.id)
    .eq('server_id', schedule.server_id)
    .eq('storage_provider_id', schedule.storage_provider_id)
    .eq('status', 'done')
    .order('started_at', { ascending: false });
  if (error) throw new Error(`Gagal mengambil backup retention: ${error.message}`);

  const logs = (data ?? []) as RetentionLog[];
  const excess = logs.slice(retention);
  let deleted = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const log of excess) {
    try {
      // A completed log without a provider ID has no cloud object to delete;
      // remove its stale metadata so it cannot consume the retention quota.
      if (log.storage_file_id) {
        await deleteFromProvider(provider, log.storage_file_id);
      }
      const { error: deleteLogError } = await service.from('backup_logs').delete().eq('id', log.id);
      if (deleteLogError) throw new Error(`Gagal menghapus log backup: ${deleteLogError.message}`);
      deleted += 1;
    } catch (error) {
      failed += 1;
      errors.push(`${log.storage_file_name ?? log.id}: ${error instanceof Error ? error.message : 'gagal dihapus'}`);
    }
  }

  return { deleted, skipped, failed, errors };
}

/** Run retention for all enabled schedules. A bad provider/log does not stop others. */
export async function cleanupRetention(): Promise<CleanupRetentionResult> {
  const service = getSupabaseServiceClient();
  const { data: schedules, error: scheduleError } = await service
    .from('backup_schedules')
    .select('*')
    // Retention also applies to schedules that were disabled after backups ran.
    .gt('retention', 0)
    .order('created_at', { ascending: true });
  if (scheduleError) throw new Error(`Gagal mengambil jadwal retention: ${scheduleError.message}`);

  let deleted = 0;
  let skipped = 0;
  let failed = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const schedule of (schedules ?? []) as BackupScheduleRow[]) {
    try {
      const { data: provider, error: providerError } = await service
        .from('storage_providers')
        .select('*')
        .eq('id', schedule.storage_provider_id)
        .maybeSingle();
      if (providerError) throw new Error(`Gagal mengambil storage provider: ${providerError.message}`);
      if (!provider) throw new Error('Storage provider tidak ditemukan');

      const result = await cleanupScheduleRetention(service, schedule, provider as StorageProviderRow);
      deleted += result.deleted;
      skipped += result.skipped;
      failed += result.failed;
      results.push({
        schedule_id: schedule.id,
        server_id: schedule.server_id,
        status: result.failed > 0 ? 'partial' : 'ok',
        deleted: result.deleted,
        skipped: result.skipped,
        failed: result.failed,
        errors: result.errors,
      });
    } catch (error) {
      failed += 1;
      results.push({
        schedule_id: schedule.id,
        server_id: schedule.server_id,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Gagal cleanup retention',
      });
    }
  }

  return {
    schedules: (schedules ?? []).length,
    deleted,
    skipped,
    failed,
    results,
  };
}
