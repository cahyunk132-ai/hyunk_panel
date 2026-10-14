import { getSessionUser } from '@/lib/auth/session';
import { getVpsForUser } from '@/lib/vps/access';
import { getVpsCpuModel } from '@/lib/vps/stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/vps/{id}/cpu-model — on-demand CPU model lookup over SSH.
 * This does not depend on Vercel Cron; the VPS card requests it directly.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  const vps = await getVpsForUser(params.id, user);
  if (!vps) {
    return Response.json({ error: 'VPS tidak ditemukan atau Anda tidak memiliki akses' }, { status: 404 });
  }

  try {
    return Response.json({ cpu_model: await getVpsCpuModel(vps) });
  } catch (error) {
    console.error('Failed to read VPS CPU model', {
      vpsId: vps.id,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return Response.json({ error: 'Tidak dapat membaca model CPU VPS' }, { status: 502 });
  }
}
