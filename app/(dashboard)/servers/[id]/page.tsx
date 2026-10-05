import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getServerByIdOrUuid, getEffectivePermissions } from '@/lib/auth/rbac';
import { ServerOverview } from '@/components/servers/ServerOverview';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Server Overview' };

export default async function ServerPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();
  const perms = await getEffectivePermissions(user, server);
  if (perms.length === 0) notFound();

  return (
    <ServerOverview
      serverId={server.id}
      dbStatus={server.status}
      memoryMb={server.memory_mb}
      cpuLimit={server.cpu_limit}
      isSuspended={server.is_suspended}
    />
  );
}
