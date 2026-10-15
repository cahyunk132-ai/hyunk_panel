import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { listVpsForUser } from '@/lib/vps/access';
import { VpsManager } from '@/components/vps/VpsManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'VPS' };

export default async function VpsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const canManageAll = isPanelAdmin(user.role);
  const [vpsList, userResult] = await Promise.all([
    listVpsForUser(user),
    canManageAll
      ? getSupabaseServiceClient()
          .from('users')
          .select('id, username, email, role')
          .order('username', { ascending: true })
      : Promise.resolve({ data: [] as Array<{ id: string; username: string; email: string | null; role: string }> }),
  ]);

  return (
    <VpsManager
      initialVps={vpsList}
      currentUserId={user.id}
      canManageAll={canManageAll}
      assignableUsers={(userResult.data ?? []) as Array<{
        id: string;
        username: string;
        email: string | null;
        role: string;
      }>}
    />
  );
}
