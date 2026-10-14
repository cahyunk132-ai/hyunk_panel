import { canManageVps } from '@/lib/vps/access';
import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';
import { makeVpsDirectory, normalizeVpsPath } from '@/lib/vps/ssh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/vps/{id}/files/mkdir */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  if (!canManageVps(access.user, access.vps)) {
    return Response.json({ error: 'Hanya pemilik VPS yang dapat membuat folder' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  if (typeof body?.path !== 'string' || !body.path.trim()) {
    return Response.json({ error: 'Path folder wajib diisi' }, { status: 400 });
  }

  try {
    const path = normalizeVpsPath(body.path);
    await makeVpsDirectory(access.vps, path);
    return Response.json({ success: true, path });
  } catch (error) {
    console.error('Failed to create VPS directory', {
      vpsId: access.vps.id,
      path: body.path,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError('Gagal membuat folder VPS');
  }
}
