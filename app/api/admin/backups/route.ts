import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import type { BackupLogRow, BackupScheduleRow } from '@/types';

export const runtime = 'nodejs';

/**
 * GET /api/admin/backups — overview semua jadwal backup aktif di semua server
 * (Owner Panel & Admin): server, provider, jadwal, dan status terakhir.
 */
export async function GET() {
  const user = await requireAdmin();
  if (user instanceof Response) return user;

  const service = getSupabaseServiceClient();
  const { data: schedules, error } = await service
    .from('backup_schedules')
    .select(
      '*, servers(id, name, uuid, status), storage_providers(id, name, provider)',
    )
    .order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (schedules ?? []) as Array<
    BackupScheduleRow & {
      servers: { id: string; name: string; uuid: string; status: string } | null;
      storage_providers: { id: string; name: string; provider: string } | null;
    }
  >;

  // Status log terakhir per jadwal.
  const withLastLog = await Promise.all(
    rows.map(async (row) => {
      const { data: lastLog } = await service
        .from('backup_logs')
        .select('*')
        .eq('schedule_id', row.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return { ...row, last_log: (lastLog as BackupLogRow | null) ?? null };
    }),
  );

  return Response.json({ schedules: withLastLog });
}
