import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import {
  getServerByIdOrUuid,
  getEffectivePermissions,
  hasPermission,
  permissionsInclude,
} from '@/lib/auth/rbac';
import { ServerOverview } from '@/components/servers/ServerOverview';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Server Overview' };

export default async function ServerPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();
  if (!(await hasPermission(user, 'server.read', server.id))) notFound();
  const perms = await getEffectivePermissions(user, server);

  return (
    <ServerOverview
      serverId={server.id}
      dbStatus={server.status}
      memoryMb={server.memory_mb}
      cpuLimit={server.cpu_limit}
      diskMb={server.disk_mb}
      isSuspended={server.is_suspended}
      expiresAt={server.expires_at}
      deleteAfterAt={server.delete_after_at}
      canManageBilling={isPanelAdmin(user.role)}
      canStart={permissionsInclude(perms, 'start')}
      canStop={permissionsInclude(perms, 'stop')}
      canRestart={permissionsInclude(perms, 'restart')}
      canKill={permissionsInclude(perms, 'kill')}
      canMonitor={permissionsInclude(perms, 'monitoring')}
    />
  );
}
