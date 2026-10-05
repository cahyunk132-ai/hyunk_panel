import { NextRequest } from 'next/server';
import { authenticateWings } from '@/lib/remote/auth';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { buildInstallationScript } from '@/lib/remote/config';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** GET /api/remote/servers/{uuid}/install — script instalasi yang diminta wings. */
export async function GET(request: NextRequest, { params }: { params: { uuid: string } }) {
  const node = await authenticateWings(request);
  if (node instanceof Response) return node;

  const service = getSupabaseServiceClient();
  const { data: server } = await service
    .from('servers')
    .select('*')
    .eq('uuid', params.uuid)
    .eq('node_id', node.id)
    .maybeSingle();
  if (!server) {
    return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });
  }

  return Response.json(buildInstallationScript(server));
}

/**
 * POST /api/remote/servers/{uuid}/install — wings melaporkan status instalasi.
 * Body: { successful: boolean, reinstall?: boolean }
 */
export async function POST(request: NextRequest, { params }: { params: { uuid: string } }) {
  const node = await authenticateWings(request);
  if (node instanceof Response) return node;

  const body = (await request.json().catch(() => null)) as {
    successful?: boolean;
    reinstall?: boolean;
  } | null;
  if (body === null || typeof body.successful !== 'boolean') {
    return Response.json({ error: 'Body wajib: { successful: boolean }' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data: server } = await service
    .from('servers')
    .select('id, uuid, name, status')
    .eq('uuid', params.uuid)
    .eq('node_id', node.id)
    .maybeSingle();
  if (!server) {
    return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });
  }

  const newStatus = body.successful ? 'offline' : 'error';
  await service.from('servers').update({ status: newStatus }).eq('id', server.id);

  await logActivity({
    serverId: server.id as string,
    action: body.reinstall ? 'server:reinstall-finished' : 'server:install-finished',
    metadata: { successful: body.successful },
  });

  return new Response(null, { status: 204 });
}
