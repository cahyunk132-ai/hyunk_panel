import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';
import type { PowerAction } from '@/types';

export const runtime = 'nodejs';

const VALID_ACTIONS: PowerAction[] = ['start', 'stop', 'restart', 'kill'];

/** POST /api/servers/{id}/power — { action: start|stop|restart|kill } */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action as PowerAction | undefined;
  if (!action || !VALID_ACTIONS.includes(action)) {
    return Response.json({ error: 'action harus salah satu dari start|stop|restart|kill' }, { status: 400 });
  }

  const perm = action === 'start' ? 'start' : action === 'stop' ? 'stop' : action === 'restart' ? 'restart' : 'kill';
  const checked = await checkPermission(user, perm, params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  try {
    await resolved.client.setPower(resolved.server.uuid, action);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal menghubungi node' },
      { status: 502 },
    );
  }

  // Optimistic state di DB — kebenaran tetap state dari Wings/websocket.
  const optimistic =
    action === 'start' ? 'starting' : action === 'restart' ? 'starting' : 'stopping';
  const service = getSupabaseServiceClient();
  await service.from('servers').update({ status: optimistic }).eq('id', resolved.server.id);

  await logActivity({
    userId: user.id,
    serverId: resolved.server.id,
    action: `power:${action}`,
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return Response.json({ ok: true, action });
}
