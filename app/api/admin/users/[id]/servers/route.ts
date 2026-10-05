import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** POST /api/admin/users/{id}/servers — assign user ke server. Body: { server_id, permissions[] } */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as {
    server_id?: string;
    permissions?: string[];
  } | null;
  if (!body?.server_id) {
    return Response.json({ error: 'Field wajib: server_id' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { error } = await service.from('server_users').upsert(
    {
      server_id: body.server_id,
      user_id: params.id,
      permissions: body.permissions ?? ['console'],
    },
    { onConflict: 'server_id,user_id' },
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: admin.id,
    serverId: body.server_id,
    action: 'admin:server-assign',
    metadata: { assigned_to: params.id, permissions: body.permissions ?? ['console'] },
  });
  return Response.json({ ok: true }, { status: 201 });
}

/** DELETE /api/admin/users/{id}/servers — cabut akses. Body: { server_id } */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as { server_id?: string } | null;
  if (!body?.server_id) {
    return Response.json({ error: 'Field wajib: server_id' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from('server_users')
    .delete()
    .eq('server_id', body.server_id)
    .eq('user_id', params.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: admin.id,
    serverId: body.server_id,
    action: 'admin:server-unassign',
    metadata: { removed_from: params.id },
  });
  return Response.json({ ok: true });
}
