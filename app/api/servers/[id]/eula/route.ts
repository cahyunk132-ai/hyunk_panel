import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** POST /api/servers/{id}/eula — tulis persetujuan EULA Minecraft lalu jalankan server. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;
  const powerAccess = await checkPermission(user, 'start', checked.server.id);
  if (powerAccess instanceof Response) return powerAccess;
  const server = checked.server;

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
