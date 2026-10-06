import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** POST /api/servers/{id}/reinstall — reinstall server via Wings (volume data tetap ada). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const result = await checkPermission(user, 'settings', params.id);
  if (result instanceof Response) return result;

  const body = (await request.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== result.server.name) {
    return Response.json(
      { error: 'Konfirmasi diperlukan. Ketik nama server dengan tepat sebelum reinstall.' },
      { status: 400 },
    );
  }

  const resolved = await resolveServerWings(result.server);
  if (resolved instanceof Response) return resolved;

  try {
    await resolved.client.reinstallServer(result.server.uuid);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal mengirim perintah reinstall ke Wings';
    await logActivity({
      userId: user.id,
      serverId: result.server.id,
      action: 'server:reinstall-failed',
      metadata: { wings_error: message },
    });
    return Response.json({ error: message }, { status: 502 });
  }

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from('servers')
    .update({ status: 'installing' })
    .eq('id', result.server.id);
  if (error) {
    return Response.json(
      { error: `Wings menerima reinstall, tetapi status panel gagal diperbarui: ${error.message}` },
      { status: 500 },
    );
  }

  await logActivity({
    userId: user.id,
    serverId: result.server.id,
    action: 'server:reinstall',
    metadata: { name: result.server.name },
  });

  return Response.json({ ok: true, status: 'installing' }, { status: 202 });
}
