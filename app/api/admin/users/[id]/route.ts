import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { canAssignRole, isUserRole } from '@/lib/auth/roles';
import { hasPermission } from '@/lib/auth/rbac';
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
    .select('server_id, role, permissions, servers(id, uuid, name, status)')
    .eq('user_id', params.id);

  const { data: activity } = await service
    .from('activity_logs')
    .select('action, metadata, created_at')
    .eq('user_id', params.id)
    .order('created_at', { ascending: false })
    .limit(20);

  return Response.json({ user, assignments: assignments ?? [], activity: activity ?? [] });
}

/** PATCH /api/admin/users/{id} — ubah role / username. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => ({}))) as {
    role?: unknown;
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

  const canManageAdmins = await hasPermission(admin, 'manage_admins');
  const update: Record<string, unknown> = {};

  if (body.role !== undefined) {
    if (!isUserRole(body.role)) return Response.json({ error: 'Role tidak valid' }, { status: 400 });
    const newRole = body.role;
    const currentRole = target.role as import('@/types').UserRole;

    if (newRole !== currentRole && target.id === admin.id) {
      return Response.json({ error: 'Tidak bisa mengubah role akun sendiri' }, { status: 400 });
    }
    if ((currentRole === 'owner_panel' || currentRole === 'admin' || newRole === 'owner_panel' || newRole === 'admin') && !canManageAdmins) {
      return Response.json({ error: 'Hanya Owner Panel yang dapat menambah, menghapus, atau mengubah role Admin/Owner Panel' }, { status: 403 });
    }
    if (!canAssignRole(admin.role, newRole)) {
      return Response.json({ error: 'Anda tidak dapat memberikan role yang lebih tinggi dari role Anda' }, { status: 403 });
    }
    update.role = newRole;
  }

  if (typeof body.username === 'string' && body.username.trim()) update.username = body.username.trim();
  if (typeof body.email === 'string' && body.email.trim()) update.email = body.email.trim().toLowerCase();

  if (Object.keys(update).length > 0) {
    const { error } = await service.from('users').update(update).eq('id', params.id);
    if (error) {
      const status = error.message.includes('Maksimal 5 Owner Panel') ? 409 : 500;
      return Response.json({ error: error.message }, { status });
    }
  }

  if (body.email || body.password) {
    const { error: authError } = await service.auth.admin.updateUserById(params.id, {
      ...(body.email ? { email: body.email.trim().toLowerCase(), email_confirm: true } : {}),
      ...(body.password ? { password: body.password } : {}),
    });
    if (authError) return Response.json({ error: authError.message }, { status: 400 });
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
  const { data: target } = await service.from('users').select('role').eq('id', params.id).maybeSingle();
  if (!target) return Response.json({ error: 'User tidak ditemukan' }, { status: 404 });

  if ((target.role === 'owner_panel' || target.role === 'admin') && !(await hasPermission(admin, 'manage_admins'))) {
    return Response.json({ error: 'Hanya Owner Panel yang dapat menghapus Admin atau Owner Panel lain' }, { status: 403 });
  }

  const { error } = await service.auth.admin.deleteUser(params.id);
  if (error) return Response.json({ error: error.message }, { status: 400 });

  await logActivity({ userId: admin.id, action: 'admin:user-delete', metadata: { target: params.id } });
  return Response.json({ ok: true });
}
