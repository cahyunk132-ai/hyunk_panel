import { posix as posixPath } from 'node:path';
import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';
import { downloadVpsFile, normalizeVpsPath } from '@/lib/vps/ssh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/vps/{id}/files/download?path=/path/to/file */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;

  const requestedPath = new URL(request.url).searchParams.get('path');
  if (!requestedPath) return Response.json({ error: 'Path wajib diisi' }, { status: 400 });

  try {
    const path = normalizeVpsPath(requestedPath);
    const content = await downloadVpsFile(access.vps, path);
    const filename = posixPath.basename(path).replace(/[\r\n"]/g, '_') || 'download';
    const encodedFilename = encodeURIComponent(filename);
    return new Response(new Uint8Array(content), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(content.byteLength),
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Failed to download VPS file', {
      vpsId: access.vps.id,
      path: requestedPath,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError('Gagal mendownload file VPS');
  }
}
