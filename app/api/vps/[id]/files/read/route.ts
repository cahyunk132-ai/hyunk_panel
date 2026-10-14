import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';
import { normalizeVpsPath, readVpsFile } from '@/lib/vps/ssh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/vps/{id}/files/read?path=/etc/nginx/nginx.conf */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;

  const requestedPath = new URL(request.url).searchParams.get('path');
  if (!requestedPath) return Response.json({ error: 'Path wajib diisi' }, { status: 400 });

  try {
    const path = normalizeVpsPath(requestedPath);
    const content = await readVpsFile(access.vps, path);
    return Response.json({ path, content: content.toString('utf8') });
  } catch (error) {
    console.error('Failed to read VPS file', {
      vpsId: access.vps.id,
      path: requestedPath,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError('Gagal membaca file VPS');
  }
}
