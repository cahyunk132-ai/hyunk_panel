import { canManageVps } from '@/lib/vps/access';
import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';
import { listVpsFiles, normalizeVpsPath, removeVpsPath } from '@/lib/vps/ssh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/vps/{id}/files?path=/ */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;

  const requestedPath = new URL(request.url).searchParams.get('path') ?? '/';
  let path: string;
  try {
    path = normalizeVpsPath(requestedPath);
    const files = await listVpsFiles(access.vps, path);
    return Response.json({ path, files });
  } catch (error) {
    console.error('Failed to list VPS files', {
      vpsId: access.vps.id,
      path: requestedPath,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError('Gagal membaca direktori VPS');
  }
}

/** DELETE /api/vps/{id}/files?path=/path/to/file */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  if (!canManageVps(access.user, access.vps)) {
    return Response.json({ error: 'Hanya pemilik VPS yang dapat menghapus file' }, { status: 403 });
  }

  const requestedPath = new URL(request.url).searchParams.get('path');
  if (!requestedPath) return Response.json({ error: 'Path wajib diisi' }, { status: 400 });

  try {
    await removeVpsPath(access.vps, requestedPath);
    return Response.json({ success: true });
  } catch (error) {
    console.error('Failed to delete VPS path', {
      vpsId: access.vps.id,
      path: requestedPath,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError('Gagal menghapus file atau folder VPS');
  }
}
