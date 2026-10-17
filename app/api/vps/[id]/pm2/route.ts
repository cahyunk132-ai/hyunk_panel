import { canManageVps } from '@/lib/vps/access';
import { validateAppName } from '@/lib/vps/commands';
import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';
import { getPm2Processes, runPm2Action, type Pm2Action } from '@/lib/vps/pm2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = new Set<Pm2Action>(['start', 'stop', 'restart', 'delete', 'flush']);

/** GET /api/vps/{id}/pm2 — list PM2 processes through SSH. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  try {
    return Response.json({ processes: await getPm2Processes(access.vps) });
  } catch (error) {
    console.error('Failed to read PM2 processes', {
      vpsId: access.vps.id,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError(error instanceof Error ? error.message : 'Gagal membaca proses PM2');
  }
}

/** POST /api/vps/{id}/pm2 — start/stop/restart/delete/flush a process. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  if (!canManageVps(access.user, access.vps)) {
    return Response.json({ error: 'Hanya pemilik VPS atau admin yang dapat mengubah proses PM2' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { action?: unknown; name?: unknown } | null;
  if (typeof body?.action !== 'string' || !ACTIONS.has(body.action as Pm2Action)) {
    return Response.json({ error: 'Action PM2 tidak valid' }, { status: 400 });
  }
  if (body.action !== 'flush' && (typeof body.name !== 'string' || !body.name.trim())) {
    return Response.json({ error: 'Nama proses wajib diisi' }, { status: 400 });
  }
  if (body.name !== undefined) {
    try {
      validateAppName(body.name);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Nama proses tidak valid' }, { status: 400 });
    }
  }

  try {
    const output = await runPm2Action(access.vps, body.action as Pm2Action, body.name);
    return Response.json({ success: true, output });
  } catch (error) {
    console.error('Failed to run PM2 action', {
      vpsId: access.vps.id,
      action: body.action,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError(error instanceof Error ? error.message : 'Action PM2 gagal');
  }
}
