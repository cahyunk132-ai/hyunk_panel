import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** GET /api/admin/users/{id} — detail user + assignment servernya. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const service = getSupabaseServiceClient();
  const { data: user } = await service
    .from('users')
    .select('id, username, email, role, created_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!user) return Response.json({ error: 'User tidak ditemukan' }, { status: 404 });

  const { data: assignments } = await service
    .from('server_users')
    .select('server_id, permissions, servers(id, uuid, name, status)')
    .eq('user_id', params.id);

  const { data: activity } = await service
    .from('activity_logs')
    .select('action, metadata, created_at')
    .eq('user_id', params.id)
    .order('created_at', { ascending: false })
    .limit(20);

  return Response.json({ user, assignments: assignments ?? [], activity: activity ?? [] });
}

/** PATCH /api/admin/users/{id} — ubah role / username. Body: { role?, username?, email?, password? } */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => ({}))) as {
    role?: string;
    username?: string;
    email?: string;
    password?: string;
  };

  const service = getSupabaseServiceClient();
  const { data: target } = await service
    .from('users')
    .select('id, role')
    .eq('id', params.id)
    .maybeSingle();
  if (!target) return Response.json({ error: 'User tidak ditemukan' }, { status: 404 });

  if (body.role && body.role !== 'admin' && target.id === admin.id) {
    return Response.json(
      { error: 'Tidak bisa menurunkan role diri sendiri. Minta admin lain.' },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = {};
  if (body.role === 'admin' || body.role === 'user') update.role = body.role;
  if (typeof body.username === 'string' && body.username.trim()) update.username = body.username.trim();
  if (typeof body.email === 'string' && body.email.trim()) update.email = body.email.trim();

  if (Object.keys(update).length > 0) {
    const { error } = await service.from('users').update(update).eq('id', params.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  if (body.email || body.password) {
    const { error: authErr } = await service.auth.admin.updateUserById(params.id, {
      ...(body.email ? { email: body.email, email_confirm: true } : {}),
      ...(body.password ? { password: body.password } : {}),
    });
    if (authErr) return Response.json({ error: authErr.message }, { status: 400 });
  }

  await logActivity({
    userId: admin.id,
    action: 'admin:user-update',
    metadata: { target: params.id, fields: [...Object.keys(update), ...(body.password ? ['password'] : [])] },
  });
  return Response.json({ ok: true });
}

/** DELETE /api/admin/users/{id} — hapus user (auth + profil). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  if (params.id === admin.id) {
    return Response.json({ error: 'Tidak bisa menghapus akun sendiri' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { error } = await service.auth.admin.deleteUser(params.id);
  if (error) return Response.json({ error: error.message }, { status: 400 });

  await logActivity({ userId: admin.id, action: 'admin:user-delete', metadata: { target: params.id } });
  return Response.json({ ok: true });
}
