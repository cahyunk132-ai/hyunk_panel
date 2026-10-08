import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { canAssignRole, isUserRole } from '@/lib/auth/roles';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** GET /api/admin/users — daftar semua user + jumlah server yang di-assign. */
export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const service = getSupabaseServiceClient();
  const [{ data: users, error }, { data: assignments }, { count: ownerCount }] = await Promise.all([
    service
      .from('users')
      .select('id, username, email, role, created_at')
      .order('created_at', { ascending: true }),
    service.from('server_users').select('user_id'),
    service.from('users').select('id', { count: 'exact', head: true }).eq('role', 'owner_panel'),
  ]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const counts = new Map<string, number>();
  for (const assignment of assignments ?? []) {
    const userId = assignment.user_id as string;
    counts.set(userId, (counts.get(userId) ?? 0) + 1);
  }

  return Response.json({
    owner_panel_count: ownerCount ?? 0,
    users: (users ?? []).map((user) => ({
      ...user,
      server_count: counts.get(user.id as string) ?? 0,
    })),
  });
}

/** POST /api/admin/users — buat akun user dengan role yang berada di bawah actor. */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
    username?: string;
    role?: string;
  } | null;

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const role = body?.role === undefined ? 'user' : body.role;

  if (!email || !password || !username) {
    return Response.json({ error: 'Field wajib: email, password, username' }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: 'Password minimal 8 karakter' }, { status: 400 });
  }
  if (!isUserRole(role)) {
    return Response.json({ error: 'Role tidak valid' }, { status: 400 });
  }
  if (!canAssignRole(admin.role, role)) {
    return Response.json(
      { error: 'Anda tidak dapat membuat user dengan role yang setara atau lebih tinggi dari role Anda' },
      { status: 403 },
    );
  }

  const service = getSupabaseServiceClient();
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (createError || !created.user) {
    return Response.json({ error: createError?.message ?? 'Gagal membuat user' }, { status: 400 });
  }

  const { data: profile, error: profileError } = await service
    .from('users')
    .upsert(
      { id: created.user.id, username, email, role },
      { onConflict: 'id' },
    )
    .select('id, username, email, role, created_at')
    .single();
  if (profileError || !profile) {
    await service.auth.admin.deleteUser(created.user.id);
    const status = profileError?.message?.includes('Maksimal 5 Owner Panel') ? 409 : 500;
    return Response.json(
      { error: profileError?.message ?? 'Gagal menyimpan profil user' },
      { status },
    );
  }

  await logActivity({
    userId: admin.id,
    action: 'admin:user-create',
    metadata: { username, role },
  });
  return Response.json({ user: profile }, { status: 201 });
}
