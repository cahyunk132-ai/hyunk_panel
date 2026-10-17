import { canManageVps } from '@/lib/vps/access';
import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';
import { readEcosystem, writeEcosystem } from '@/lib/vps/pm2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/vps/{id}/pm2/ecosystem */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  try {
    return Response.json({ content: await readEcosystem(access.vps) });
  } catch (error) {
    return vpsOperationError(error instanceof Error ? error.message : 'Gagal membaca ecosystem.config.js');
  }
}

/** POST /api/vps/{id}/pm2/ecosystem */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  if (!canManageVps(access.user, access.vps)) {
    return Response.json({ error: 'Hanya pemilik VPS atau admin yang dapat menyimpan ecosystem.config.js' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { content?: unknown } | null;
  if (typeof body?.content !== 'string') {
    return Response.json({ error: 'Field content wajib berupa teks' }, { status: 400 });
  }
  try {
    await writeEcosystem(access.vps, body.content);
    return Response.json({ success: true });
  } catch (error) {
    return vpsOperationError(error instanceof Error ? error.message : 'Gagal menyimpan ecosystem.config.js');
  }
}
