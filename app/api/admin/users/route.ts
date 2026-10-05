import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** GET /api/admin/users — daftar semua user + jumlah server yang di-assign. */
export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const service = getSupabaseServiceClient();
  const { data: users, error } = await service
    .from('users')
    .select('id, username, email, role, created_at')
    .order('created_at', { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const { data: assignments } = await service.from('server_users').select('user_id');
  const counts = new Map<string, number>();
  for (const a of assignments ?? []) {
    const uid = a.user_id as string;
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }

  return Response.json({
    users: (users ?? []).map((u) => ({ ...u, server_count: counts.get(u.id as string) ?? 0 })),
  });
}

/** POST /api/admin/users — buat user baru. Body: { email, password, username, role } */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
    username?: string;
    role?: string;
  } | null;

  if (!body?.email || !body.password || !body.username) {
    return Response.json({ error: 'Field wajib: email, password, username' }, { status: 400 });
  }
  if (body.password.length < 8) {
    return Response.json({ error: 'Password minimal 8 karakter' }, { status: 400 });
  }
  const role = body.role === 'admin' ? 'admin' : 'user';

  const service = getSupabaseServiceClient();
  const { data: created, error: createErr } = await service.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { username: body.username },
  });
  if (createErr || !created.user) {
    return Response.json({ error: createErr?.message ?? 'Gagal membuat user' }, { status: 400 });
  }

  // Trigger handle_new_user membuat baris; pastikan username/role sesuai permintaan.
  const { data: profile, error: profileErr } = await service
    .from('users')
    .upsert(
      { id: created.user.id, username: body.username, email: body.email, role },
      { onConflict: 'id' },
    )
    .select('id, username, email, role, created_at')
    .single();
  if (profileErr) {
    return Response.json({ error: profileErr.message }, { status: 500 });
  }

  await logActivity({
    userId: admin.id,
    action: 'admin:user-create',
    metadata: { username: body.username, role },
  });
  return Response.json({ user: profile }, { status: 201 });
}
