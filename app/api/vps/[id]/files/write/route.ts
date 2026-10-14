import { canManageVps } from '@/lib/vps/access';
import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';
import { normalizeVpsPath, writeVpsFile } from '@/lib/vps/ssh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/vps/{id}/files/write — replace a file through SFTP. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  if (!canManageVps(access.user, access.vps)) {
    return Response.json({ error: 'Hanya pemilik VPS yang dapat mengubah file' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { path?: unknown; content?: unknown } | null;
  if (typeof body?.path !== 'string' || typeof body.content !== 'string') {
    return Response.json({ error: 'Path dan content wajib diisi' }, { status: 400 });
  }

  try {
    const path = normalizeVpsPath(body.path);
    await writeVpsFile(access.vps, path, body.content);
    return Response.json({ success: true, path });
  } catch (error) {
    console.error('Failed to write VPS file', {
      vpsId: access.vps.id,
      path: body.path,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError('Gagal menyimpan file VPS');
  }
}
