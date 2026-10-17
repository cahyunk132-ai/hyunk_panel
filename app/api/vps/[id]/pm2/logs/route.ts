import { validateAppName } from '@/lib/vps/commands';
import { getPm2Logs } from '@/lib/vps/pm2';
import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/vps/{id}/pm2/logs?name=app&lines=100 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;

  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  const lines = url.searchParams.get('lines') ?? '100';
  if (!name) return Response.json({ error: 'Parameter name wajib diisi' }, { status: 400 });
  try {
    validateAppName(name);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Nama proses tidak valid' }, { status: 400 });
  }

  try {
    return Response.json({ logs: await getPm2Logs(access.vps, name, lines) });
  } catch (error) {
    console.error('Failed to read PM2 logs', {
      vpsId: access.vps.id,
      name,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError(error instanceof Error ? error.message : 'Gagal membaca log PM2');
  }
}
