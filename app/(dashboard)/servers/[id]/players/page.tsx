import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getEffectivePermissions, getServerByIdOrUuid, permissionsInclude } from '@/lib/auth/rbac';
import { isBedrockServer } from '@/lib/minecraft/playerdata';
import { PlayerManager } from '@/components/servers/PlayerManager';
import { BedrockPlayerManager } from '@/components/servers/BedrockPlayerManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Players' };

export default async function PlayersPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();

  const perms = await getEffectivePermissions(user, server);
  const canManagePlayers = permissionsInclude(perms, 'players');
  if (!canManagePlayers) notFound();

  // Player actions are individually allow-listed by these endpoints. The player
  // permission does not grant access to the general-purpose console command API.
  const canSendCommand = canManagePlayers;
  const canEditFiles = canManagePlayers;

  // Bedrock Edition tidak punya playerdata/usercache: tab Players memakai
  // allowlist.json + permissions.json (component terpisah). Tab Java tidak berubah.
  if (isBedrockServer(server)) {
    return (
      <BedrockPlayerManager
        serverId={server.id}
        canEdit={canEditFiles}
        canSendCommand={canSendCommand}
      />
    );
  }

  // canEditFiles dipakai tombol Reset Data (hapus file playerdata via Wings).
  return (
    <PlayerManager
      serverId={server.id}
      canSendCommand={canSendCommand}
      canEditFiles={canEditFiles}
    />
  );
}
