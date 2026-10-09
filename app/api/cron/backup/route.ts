import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { runBackupJob } from '@/lib/storage/backupJob';
import type { BackupScheduleRow } from '@/types';

export const runtime = 'nodejs';
// Proses bisa berjalan lama (download + upload backup besar) — butuh Vercel Pro.
export const maxDuration = 300;

/**
 * GET /api/cron/backup — handler Vercel Cron (lihat vercel.json).
 *
 * - Validasi `Authorization: Bearer {CRON_SECRET}` (timing-safe compare).
 * - Ambil semua jadwal aktif yang sudah jatuh tempo (next_run_at <= now).
 * - Jalankan satu per satu; jadwal diproses paralel bisa menyusul via cron berikutnya.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET belum di-set di environment' }, { status: 500 });
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const service = getSupabaseServiceClient();
  const { data: schedules, error } = await service
    .from('backup_schedules')
    .select('*')
    .eq('is_enabled', true)
    .lte('next_run_at', new Date().toISOString())
    .order('next_run_at', { ascending: true })
    .limit(10);
  if (error) return Response.json({ error: error.message }, { status: 500 });

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

  return Response.json({ processed: results.length, results });
}
