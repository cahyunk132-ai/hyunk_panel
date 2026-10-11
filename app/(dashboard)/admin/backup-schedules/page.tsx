import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { BackupSchedulesAdmin } from '@/components/admin/BackupSchedulesAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Auto Backups' };

/**
 * /admin/backup-schedules — overview semua jadwal auto backup di seluruh panel
 * (Owner Panel & Admin). Monitoring hasil eksekusinya ada di /admin/backups.
 */
export default async function AdminBackupSchedulesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/dashboard');

  return <BackupSchedulesAdmin />;
}
