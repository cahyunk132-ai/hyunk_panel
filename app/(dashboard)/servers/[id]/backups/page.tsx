import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { checkPermission, getEffectivePermissions, hasPermission, permissionsInclude } from '@/lib/auth/rbac';
import { BackupManager } from '@/components/servers/BackupManager';
import { AutoBackupSchedule } from '@/components/servers/AutoBackupSchedule';
import { BackupHistory } from '@/components/servers/BackupHistory';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Backups' };

export default async function BackupsPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const result = await checkPermission(user, 'backups', params.id);
  if (result instanceof Response) notFound();

  const [permissions, canRestore, canManageSchedule] = await Promise.all([
    getEffectivePermissions(user, result.server),
    hasPermission(user, 'backup.restore', result.server.id),
    hasPermission(user, 'backup.schedule', result.server.id),
  ]);

  return (
    <div className="space-y-4">
      <AutoBackupSchedule serverId={result.server.id} canManage={canManageSchedule} />
      <BackupHistory serverId={result.server.id} />
      <BackupManager
        serverId={result.server.id}
        canDelete={permissionsInclude(permissions, 'backups.delete')}
        canRestore={canRestore}
      />
    </div>
  );
}
