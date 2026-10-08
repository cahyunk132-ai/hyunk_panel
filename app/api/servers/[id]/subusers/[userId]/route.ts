import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** DELETE /api/servers/{id}/subusers/{userId} — cabut subuser dari server. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; userId: string } },
) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const access = await checkPermission(user, 'assign_subuser', params.id);
  if (access instanceof Response) return access;

  const service = getSupabaseServiceClient();
  const { data: assignment, error: lookupError } = await service
    .from('server_users')
    .select('role')
    .eq('server_id', access.server.id)
    .eq('user_id', params.userId)
    .maybeSingle();
  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (!assignment || assignment.role !== 'subuser') {
    return Response.json({ error: 'Subuser tidak ditemukan di server ini' }, { status: 404 });
  }

  const { error } = await service
    .from('server_users')
    .delete()
    .eq('server_id', access.server.id)
    .eq('user_id', params.userId)
    .eq('role', 'subuser');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: user.id,
    serverId: access.server.id,
    action: 'server:subuser-remove',
    metadata: { removed_user_id: params.userId },
  });
  return Response.json({ ok: true });
}
