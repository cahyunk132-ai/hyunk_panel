import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { UsersManager, type AdminUserRow } from '@/components/users/UsersManager';
import { isPanelAdmin } from '@/lib/auth/roles';
import type { UserRole } from '@/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users' };

export default async function UsersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/dashboard');

  const service = getSupabaseServiceClient();
  const [{ data: users }, { data: assignments }, { count: ownerPanelCount }] = await Promise.all([
    service
      .from('users')
      .select('id, username, email, role, created_at')
      .order('created_at', { ascending: true }),
    service.from('server_users').select('user_id'),
    service.from('users').select('id', { count: 'exact', head: true }).eq('role', 'owner_panel'),
  ]);

  const counts = new Map<string, number>();
  for (const assignment of assignments ?? []) {
    const userId = assignment.user_id as string;
    counts.set(userId, (counts.get(userId) ?? 0) + 1);
  }

  const rows: AdminUserRow[] = (users ?? []).map((row) => ({
    id: row.id as string,
    username: row.username as string,
    email: (row.email as string | null) ?? null,
    role: row.role as UserRole,
    created_at: row.created_at as string,
    server_count: counts.get(row.id as string) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Users</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Kelola akun dan role. Owner Panel dapat mengelola Admin; Admin hanya dapat mengelola role di bawahnya.
        </p>
      </div>
      <UsersManager
        users={rows}
        currentUserId={user.id}
        currentRole={user.role}
        ownerPanelCount={ownerPanelCount ?? 0}
      />
    </div>
  );
}
