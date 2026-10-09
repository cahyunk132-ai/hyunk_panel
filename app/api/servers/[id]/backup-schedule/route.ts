import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { computeNextRunAt, isValidRetention, isValidTimeOfDay, isValidDayOfWeek } from '@/lib/storage/schedule';
import { toPublicProvider } from '@/lib/storage';
import type { BackupInterval, BackupScheduleRow, StorageProviderRow } from '@/types';

export const runtime = 'nodejs';

/**
 * GET /api/servers/[id]/backup-schedule — jadwal backup server + daftar storage
 * provider milik user (untuk dropdown). Lihat jadwal = permission `backups`.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'backups', params.id);
  if (checked instanceof Response) return checked;

  const service = getSupabaseServiceClient();
  const [{ data: schedule }, { data: providers }] = await Promise.all([
    service
      .from('backup_schedules')
      .select('*')
      .eq('server_id', checked.server.id)
      .maybeSingle(),
    service
      .from('storage_providers')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
  ]);

  return Response.json({
    schedule: (schedule as BackupScheduleRow | null) ?? null,
    providers: ((providers ?? []) as StorageProviderRow[]).map((p) => toPublicProvider(p)),
  });
}

/**
 * POST /api/servers/[id]/backup-schedule — buat/update jadwal backup (1 per server).
 * Permission: owner_panel / admin / moderator (permission `backup.schedule`).
 *
 * Body: { storage_provider_id, is_enabled?, interval, time_of_day?, day_of_week?,
 *         retention?, ignore_files? }
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'backup.schedule', params.id);
  if (checked instanceof Response) return checked;

  const body = (await request.json().catch(() => ({}))) as {
    storage_provider_id?: string;
    is_enabled?: boolean;
    interval?: BackupInterval;
    time_of_day?: string;
    day_of_week?: number | null;
    retention?: number;
    ignore_files?: string;
  };

  if (!body.storage_provider_id) {
    return Response.json({ error: 'storage_provider_id wajib diisi' }, { status: 400 });
  }
  if (!body.interval || !['hourly', 'daily', 'weekly'].includes(body.interval)) {
    return Response.json({ error: "interval harus 'hourly', 'daily', atau 'weekly'" }, { status: 400 });
  }

  const timeOfDay = body.time_of_day ?? '03:00';
  if (body.interval !== 'hourly' && !isValidTimeOfDay(timeOfDay)) {
    return Response.json({ error: 'time_of_day harus format HH:MM (00:00–23:59)' }, { status: 400 });
  }

  let dayOfWeek: number | null = null;
  if (body.interval === 'weekly') {
    if (body.day_of_week === undefined || body.day_of_week === null || !isValidDayOfWeek(Number(body.day_of_week))) {
      return Response.json({ error: 'day_of_week wajib 0-6 (0 = Minggu) untuk interval weekly' }, { status: 400 });
    }
    dayOfWeek = Number(body.day_of_week);
  }

  const retention = body.retention ?? 5;
  if (!isValidRetention(Number(retention))) {
    return Response.json({ error: 'retention harus bilangan bulat 1-20' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();

  // Storage provider harus milik user yang menyetel jadwal.
  const { data: provider } = await service
    .from('storage_providers')
    .select('id, user_id, is_active, provider, name, created_at, config')
    .eq('id', body.storage_provider_id)
    .maybeSingle();
  if (!provider) {
    return Response.json({ error: 'Storage provider tidak ditemukan' }, { status: 404 });
  }
  if ((provider as StorageProviderRow).user_id !== user.id) {
    return Response.json({ error: 'Storage provider ini bukan milik Anda' }, { status: 403 });
  }
  if (!(provider as StorageProviderRow).is_active) {
    return Response.json({ error: 'Storage provider sedang nonaktif' }, { status: 400 });
  }

  const nextRunAt = computeNextRunAt(body.interval, timeOfDay, dayOfWeek);

  // unique(server_id) → upsert berdasarkan server.
  const { data: schedule, error } = await service
    .from('backup_schedules')
    .upsert(
      {
        server_id: checked.server.id,
        storage_provider_id: body.storage_provider_id,
        is_enabled: body.is_enabled ?? true,
        interval: body.interval,
        time_of_day: body.interval === 'hourly' ? null : timeOfDay,
        day_of_week: dayOfWeek,
        retention: Number(retention),
        ignore_files: body.ignore_files ?? '',
        created_by: user.id,
        next_run_at: nextRunAt.toISOString(),
      },
      { onConflict: 'server_id' },
    )
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ schedule: schedule as BackupScheduleRow });
}

/**
 * DELETE /api/servers/[id]/backup-schedule — hapus jadwal backup server.
 * Permission: owner_panel / admin / moderator (permission `backup.schedule`).
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'backup.schedule', params.id);
  if (checked instanceof Response) return checked;

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from('backup_schedules')
    .delete()
    .eq('server_id', checked.server.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
