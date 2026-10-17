import { canManageVps } from '@/lib/vps/access';
import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';
import { createPm2Process } from '@/lib/vps/pm2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/vps/{id}/pm2/create */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  if (!canManageVps(access.user, access.vps)) {
    return Response.json({ error: 'Hanya pemilik VPS atau admin yang dapat membuat proses PM2' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    script?: unknown;
    interpreter?: unknown;
    cwd?: unknown;
  } | null;
  if (!body?.name || !body.script) {
    return Response.json({ error: 'Field wajib: name dan script' }, { status: 400 });
  }

  try {
    const output = await createPm2Process(access.vps, {
      name: body.name,
      script: body.script,
      interpreter: body.interpreter,
      cwd: body.cwd,
    });
    return Response.json({ success: true, output }, { status: 201 });
  } catch (error) {
    console.error('Failed to create PM2 process', {
      vpsId: access.vps.id,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError(error instanceof Error ? error.message : 'Gagal membuat proses PM2');
  }
}
