import { canManageVps } from '@/lib/vps/access';
import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';
import { normalizeVpsPath, renameVpsPath } from '@/lib/vps/ssh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/vps/{id}/files/rename */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  if (!canManageVps(access.user, access.vps)) {
    return Response.json({ error: 'Hanya pemilik VPS yang dapat me-rename file' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
  if (typeof body?.from !== 'string' || typeof body.to !== 'string' || !body.from.trim() || !body.to.trim()) {
    return Response.json({ error: 'Path asal dan tujuan wajib diisi' }, { status: 400 });
  }

  try {
    const from = normalizeVpsPath(body.from);
    const to = normalizeVpsPath(body.to);
    await renameVpsPath(access.vps, from, to);
    return Response.json({ success: true, from, to });
  } catch (error) {
    console.error('Failed to rename VPS path', {
      vpsId: access.vps.id,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError('Gagal mengganti nama file VPS');
  }
}
