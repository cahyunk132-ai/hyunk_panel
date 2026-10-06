import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getEffectivePermissions, getServerByIdOrUuid, permissionsInclude } from '@/lib/auth/rbac';
import { PlayerManager } from '@/components/servers/PlayerManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Players' };

export default async function PlayersPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();

  // Melihat daftar player = akses console (monitoring); aksi kick/ban/op = console.send.
  const perms = await getEffectivePermissions(user, server);
  if (!permissionsInclude(perms, 'console')) notFound();

  const canSendCommand = permissionsInclude(perms, 'console.send') || perms.includes('*');

  return <PlayerManager serverId={server.id} canSendCommand={canSendCommand} />;
}
