import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { BackupMonitor } from '@/components/admin/BackupMonitor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Backup Monitor' };

/**
 * /admin/backups — monitoring semua backup log dari seluruh user/server di panel.
 * Akses: Owner Panel & Admin saja. Data diambil client-side lewat
 * GET /api/admin/backup-logs (service role, bypass RLS).
 */
export default async function AdminBackupsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/dashboard');

  return <BackupMonitor />;
}
