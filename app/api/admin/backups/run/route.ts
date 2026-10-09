import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { runBackupJob } from '@/lib/storage/backupJob';
import type { BackupScheduleRow } from '@/types';

export const runtime = 'nodejs';
// Backup bisa berjalan lama (download + upload >1GB) — butuh Vercel Pro.
export const maxDuration = 300;

/**
 * POST /api/admin/backups/run — force run satu jadwal backup (Owner Panel & Admin).
 * Body: { schedule_id }
 */
export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => ({}))) as { schedule_id?: string };
  if (!body.schedule_id) {
    return Response.json({ error: 'schedule_id wajib diisi' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data: schedule } = await service
    .from('backup_schedules')
    .select('*')
    .eq('id', body.schedule_id)
    .maybeSingle();
  if (!schedule) {
    return Response.json({ error: 'Jadwal backup tidak ditemukan' }, { status: 404 });
  }

  const result = await runBackupJob(schedule as BackupScheduleRow, 'admin', user.id);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
