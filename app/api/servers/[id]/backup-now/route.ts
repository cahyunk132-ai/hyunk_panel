import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { runBackupJob } from '@/lib/storage/backupJob';
import type { BackupScheduleRow } from '@/types';

export const runtime = 'nodejs';
// Backup bisa berjalan lama (download + upload >1GB) — butuh Vercel Pro.
export const maxDuration = 300;

/**
 * POST /api/servers/[id]/backup-now — jalankan pipeline auto backup sekarang
 * (mengikuti jadwal yang tersimpan: provider, retention, ignore_files).
 * Permission: owner_panel / admin / moderator (permission `backup.schedule`).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'backup.schedule', params.id);
  if (checked instanceof Response) return checked;

  const service = getSupabaseServiceClient();
  const { data: schedule } = await service
    .from('backup_schedules')
    .select('*')
    .eq('server_id', checked.server.id)
    .maybeSingle();
  if (!schedule) {
    return Response.json(
      { error: 'Belum ada jadwal backup — simpan jadwal terlebih dahulu sebelum menjalankan manual' },
      { status: 404 },
    );
  }

  const result = await runBackupJob(schedule as BackupScheduleRow, 'manual', user.id);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
