import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getEffectivePermissions, getServerByIdOrUuid, permissionsInclude } from '@/lib/auth/rbac';
import { ServerSettings } from '@/components/servers/ServerSettings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Server Settings' };

export default async function SettingsPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();
  const perms = await getEffectivePermissions(user, server);
  if (!permissionsInclude(perms, 'settings')) notFound();

  return <ServerSettings server={server} isAdmin={user.role === 'admin'} />;
}
