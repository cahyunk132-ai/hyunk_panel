import { requireUser } from '@/lib/auth/session';
import {
  getEffectivePermissions,
  getServerByIdOrUuid,
  permissionsInclude,
} from '@/lib/auth/rbac';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** POST /api/servers/{id}/eula — tulis persetujuan EULA Minecraft lalu jalankan server. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const server = await getServerByIdOrUuid(params.id);
  if (!server) {
    return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });
  }
  if (server.is_suspended && user.role !== 'admin') {
    return Response.json({ error: 'Server sedang disuspend' }, { status: 403 });
  }

  const permissions = await getEffectivePermissions(user, server);
  if (!permissionsInclude(permissions, 'files.edit')) {
    return Response.json({ error: 'Butuh permission "files.edit"' }, { status: 403 });
  }

  const resolved = await resolveServerWings(server);
  if (resolved instanceof Response) return resolved;

  try {
    await resolved.client.writeFile(
      resolved.server.uuid,
      '/eula.txt',
      '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\neula=true\n',
    );
    await resolved.client.setPower(resolved.server.uuid, 'start');
    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'server:eula-accepted',
      metadata: { file: '/eula.txt' },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal menerima EULA Minecraft' },
      { status: 502 },
    );
  }
}
