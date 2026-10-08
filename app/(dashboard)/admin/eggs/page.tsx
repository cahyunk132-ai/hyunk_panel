import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { EggManager } from '@/components/eggs/EggManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Egg Manager' };

export default async function EggManagerPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/');

  return <EggManager />;
}
