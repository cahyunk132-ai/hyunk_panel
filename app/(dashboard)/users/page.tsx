import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { UsersManager, type AdminUserRow } from '@/components/users/UsersManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users' };

export default async function UsersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');

  const service = getSupabaseServiceClient();
  const { data: users } = await service
    .from('users')
    .select('id, username, email, role, created_at')
    .order('created_at', { ascending: true });

  const { data: assignments } = await service.from('server_users').select('user_id');
  const counts = new Map<string, number>();
  for (const a of assignments ?? []) {
    const uid = a.user_id as string;
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }

  const rows: AdminUserRow[] = (users ?? []).map((u) => ({
    id: u.id as string,
    username: u.username as string,
    email: (u.email as string | null) ?? null,
    role: u.role as 'admin' | 'user',
    created_at: u.created_at as string,
    server_count: counts.get(u.id as string) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Users</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Manajemen akun dan role. Hanya admin yang bisa mengakses halaman ini.
        </p>
      </div>
      <UsersManager users={rows} currentUserId={user.id} />
    </div>
  );
}
