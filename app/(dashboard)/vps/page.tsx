import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { listVpsForUser } from '@/lib/vps/access';
import { VpsManager } from '@/components/vps/VpsManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'VPS' };

export default async function VpsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const vpsList = await listVpsForUser(user);

  return (
    <VpsManager
      initialVps={vpsList}
      currentUserId={user.id}
      canManageAll={isPanelAdmin(user.role)}
    />
  );
}
