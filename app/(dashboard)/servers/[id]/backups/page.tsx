import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { checkPermission, getEffectivePermissions, hasPermission, permissionsInclude } from '@/lib/auth/rbac';
import { BackupManager } from '@/components/servers/BackupManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Backups' };

export default async function BackupsPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const result = await checkPermission(user, 'backups', params.id);
  if (result instanceof Response) notFound();

  const [permissions, canRestore] = await Promise.all([
    getEffectivePermissions(user, result.server),
    hasPermission(user, 'backup.restore', result.server.id),
  ]);

  return (
    <BackupManager
      serverId={result.server.id}
      canDelete={permissionsInclude(permissions, 'backups.delete')}
      canRestore={canRestore}
    />
  );
}
