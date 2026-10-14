import { getSessionUser } from '@/lib/auth/session';
import { getVpsForUser } from '@/lib/vps/access';
import { getVpsStats } from '@/lib/vps/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/vps/{id}/stats — live CPU/RAM/Disk data over the VPS SSH connection. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  const vps = await getVpsForUser(params.id, user);
  if (!vps) {
    return Response.json({ error: 'VPS tidak ditemukan atau Anda tidak memiliki akses' }, { status: 404 });
  }

  try {
    return Response.json(await getVpsStats(vps));
  } catch (error) {
    console.error('Failed to read VPS stats', {
      vpsId: vps.id,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return Response.json({ error: 'Tidak dapat terhubung ke VPS' }, { status: 502 });
  }
}
