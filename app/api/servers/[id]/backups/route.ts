import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** GET /api/servers/{id}/backups — daftar backup dari database panel. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'backups', params.id);
  if (checked instanceof Response) return checked;

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('backups')
    .select('*')
    .eq('server_id', checked.server.id)
    .order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ backups: data });
}

/** POST /api/servers/{id}/backups — { name?, ignored_files? } mulai pembuatan backup di node. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'backups', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    ignored_files?: string;
  };
  const backupUuid = crypto.randomUUID();

  try {
    await resolved.client.createBackup(resolved.server.uuid, backupUuid, body.ignored_files ?? '');
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal memulai backup di node' },
      { status: 502 },
    );
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('backups')
    .insert({
      server_id: resolved.server.id,
      uuid: backupUuid,
      name: body.name?.trim() || `Backup ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      is_successful: null, // sedang berjalan — diperbarui saat selesai (manual/API)
    })
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: user.id,
    serverId: resolved.server.id,
    action: 'backup:create',
    metadata: { backup_uuid: backupUuid },
  });
  return Response.json({ backup: data }, { status: 201 });
}
