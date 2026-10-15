import { NextRequest } from 'next/server';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { requireCronSecret } from '@/lib/cron';
import { runBackupJob } from '@/lib/storage/backupJob';
import { suspendExpired } from '@/lib/billing/suspendExpired';
import { deleteExpiredData } from '@/lib/billing/deleteExpiredData';
import { cleanupRetention } from '@/lib/billing/cleanupRetention';
import type { BackupScheduleRow } from '@/types';

export const runtime = 'nodejs';
// Proses bisa berjalan lama (billing + download + upload backup besar) — butuh Vercel Pro.
export const maxDuration = 300;

/**
 * GET /api/cron/backup — handler Vercel Cron (lihat vercel.json).
 *
 * - Validasi `Authorization: Bearer {CRON_SECRET}` (timing-safe compare).
 * - Jalankan maintenance billing sebelum pipeline backup.
 * - Ambil semua jadwal aktif yang sudah jatuh tempo (next_run_at <= now).
 * - Jalankan backup satu per satu; satu server gagal tidak menghentikan server lain.
 */
export async function GET(request: NextRequest) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const maintenance: Record<string, unknown> = {};
  try {
    maintenance.suspend_expired = await suspendExpired();
  } catch (error) {
    maintenance.suspend_expired = {
      ok: false,
      error: error instanceof Error ? error.message : 'Gagal suspend server expired',
    };
  }

  try {
    maintenance.delete_expired_data = await deleteExpiredData();
  } catch (error) {
    maintenance.delete_expired_data = {
      ok: false,
      error: error instanceof Error ? error.message : 'Gagal menghapus server expired',
    };
  }

  try {
    maintenance.cleanup_retention = await cleanupRetention();
  } catch (error) {
    maintenance.cleanup_retention = {
      ok: false,
      error: error instanceof Error ? error.message : 'Gagal cleanup retention',
    };
  }

  const service = getSupabaseServiceClient();
  const { data: schedules, error } = await service
    .from('backup_schedules')
    .select('*')
    .eq('is_enabled', true)
    .lte('next_run_at', new Date().toISOString())
    .order('next_run_at', { ascending: true })
    .limit(10);
  if (error) {
    return Response.json({ ok: false, maintenance, error: error.message }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const schedule of (schedules ?? []) as BackupScheduleRow[]) {
    try {
      const result = await runBackupJob(schedule, 'cron');
      results.push({ schedule_id: schedule.id, server_id: schedule.server_id, ...result });
    } catch (err) {
      results.push({
        schedule_id: schedule.id,
        server_id: schedule.server_id,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  return Response.json({
    ok: true,
    maintenance,
    processed: results.length,
    results,
  });
}
