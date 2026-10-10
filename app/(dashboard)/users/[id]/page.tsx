import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { UserDetailManager, type Assignment } from '@/components/users/UserDetailManager';
import { RoleBadge } from '@/components/users/RoleBadge';
import { isPanelAdmin } from '@/lib/auth/roles';
import type { UserRole } from '@/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Detail User' };

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/dashboard');

  const service = getSupabaseServiceClient();
  const { data: target } = await service
    .from('users')
    .select('id, username, email, role, created_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!target) notFound();

  const { data: rawAssignments } = await service
    .from('server_users')
    .select('server_id, role, permissions, servers(id, uuid, name, status)')
    .eq('user_id', params.id);

  const assignments: Assignment[] = (rawAssignments ?? []).map((a) => {
    const s = a.servers as { id?: string; uuid?: string; name?: string; status?: string } | null;
    return {
      server_id: a.server_id as string,
      role: (a.role === 'user' ? 'user' : 'subuser') as 'user' | 'subuser',
      server_name: s?.name ?? '—',
      server_uuid: s?.uuid ?? '—',
      status: s?.status ?? 'offline',
      permissions: (a.permissions as string[]) ?? [],
    };
  });

  const { data: allServers } = await service
    .from('servers')
    .select('id, name')
    .order('created_at', { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/users" className="text-xs text-ink-faint hover:text-ink">
          ← Semua users
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-xl font-bold">{target.username as string}</h1>
          <RoleBadge role={target.role as UserRole} />
        </div>
        <p className="mt-0.5 text-sm text-ink-muted">{target.email as string}</p>
      </div>

      <UserDetailManager
        userId={target.id as string}
        username={target.username as string}
        role={target.role as UserRole}
        assignments={assignments}
        allServers={(allServers ?? []) as Array<{ id: string; name: string }>}
        isSelf={target.id === user.id}
      />
    </div>
  );
}
