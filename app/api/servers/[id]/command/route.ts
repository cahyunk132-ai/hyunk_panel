import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** POST /api/servers/{id}/command — { command: string } kirim perintah via REST Wings. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => null)) as { command?: string } | null;
  const command = body?.command?.trim();
  if (!command) return Response.json({ error: 'command wajib diisi' }, { status: 400 });

  const checked = await checkPermission(user, 'console.send', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  try {
    await resolved.client.sendCommands(resolved.server.uuid, [command]);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal mengirim command' },
      { status: 502 },
    );
  }

  await logActivity({
    userId: user.id,
    serverId: resolved.server.id,
    action: 'console:command',
    metadata: { command: command.slice(0, 200) },
  });

  return Response.json({ ok: true });
}
