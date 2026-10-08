import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';
import { createBackupDownloadToken } from '@/lib/wings/jwt';

export const runtime = 'nodejs';

async function getBackup(serverDbId: string, backupId: string) {
  const service = getSupabaseServiceClient();
  const { data } = await service
    .from('backups')
    .select('*')
    .eq('server_id', serverDbId)
    .or(`id.eq.${backupId},uuid.eq.${backupId}`)
    .maybeSingle();
  return data;
}

/** GET /api/servers/{id}/backups/{backupId} — detail + URL download signed. */
export async function GET(_req: NextRequest, { params }: { params: { id: string; backupId: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'backups', params.id);
  if (checked instanceof Response) return checked;

  const backup = await getBackup(checked.server.id, params.backupId);
  if (!backup) return Response.json({ error: 'Backup tidak ditemukan' }, { status: 404 });

  let download_url: string | null = null;
  if (backup.uuid && backup.is_successful !== false) {
    const resolved = await resolveServerWings(checked.server);
    if (!(resolved instanceof Response)) {
      const token = createBackupDownloadToken(
        { nodeSecret: resolved.client.token, serverUuid: resolved.server.uuid, userUuid: user.id },
        backup.uuid as string,
      );
      download_url = resolved.client.downloadBackupUrl(token);
    }
  }

  return Response.json({ backup, download_url });
}

/** POST /api/servers/{id}/backups/{backupId} — restore backup. Body: { truncate?: boolean } */
export async function POST(request: NextRequest, { params }: { params: { id: string; backupId: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'backup.restore', params.id);
  if (checked instanceof Response) return checked;

  const backup = await getBackup(checked.server.id, params.backupId);
  if (!backup?.uuid) return Response.json({ error: 'Backup tidak ditemukan' }, { status: 404 });

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const body = (await request.json().catch(() => ({}))) as { truncate?: boolean };
  try {
    await resolved.client.restoreBackup(resolved.server.uuid, backup.uuid as string, !!body.truncate);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal restore backup' },
      { status: 502 },
    );
  }

  await logActivity({
    userId: user.id,
    serverId: resolved.server.id,
    action: 'backup:restore',
    metadata: { backup_uuid: backup.uuid, truncate: !!body.truncate },
  });
  return Response.json({ ok: true });
}

/** DELETE /api/servers/{id}/backups/{backupId} — hapus backup di node + tandai di DB. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; backupId: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'backups.delete', params.id);
  if (checked instanceof Response) return checked;

  const backup = await getBackup(checked.server.id, params.backupId);
  if (!backup) return Response.json({ error: 'Backup tidak ditemukan' }, { status: 404 });

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  if (backup.uuid) {
    try {
      await resolved.client.deleteBackup(resolved.server.uuid, backup.uuid as string);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Gagal menghapus backup di node' },
        { status: 502 },
      );
    }
  }

  const service = getSupabaseServiceClient();
  await service.from('backups').delete().eq('id', backup.id);

  await logActivity({
    userId: user.id,
    serverId: resolved.server.id,
    action: 'backup:delete',
    metadata: { backup_uuid: backup.uuid },
  });
  return Response.json({ ok: true });
}
