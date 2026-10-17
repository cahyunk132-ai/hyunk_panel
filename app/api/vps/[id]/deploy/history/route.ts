import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { isAuthorizedVps, requireVpsAccess } from '@/lib/vps/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/vps/{id}/deploy/history */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('vps_deploy_logs')
    .select('id, vps_id, app_name, deploy_path, status, log, deployed_by, created_at')
    .eq('vps_id', access.vps.id)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ logs: data ?? [] });
}
