import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { BackupSchedulesAdmin } from '@/components/admin/BackupSchedulesAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Auto Backups' };

export default async function AdminBackupsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/');

  return <BackupSchedulesAdmin />;
}
