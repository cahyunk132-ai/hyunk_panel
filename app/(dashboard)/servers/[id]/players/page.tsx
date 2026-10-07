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

  // Melihat daftar player = akses console (monitoring); aksi kick/ban/op = console.send.
  const perms = await getEffectivePermissions(user, server);
  if (!permissionsInclude(perms, 'console')) notFound();

  const canSendCommand = permissionsInclude(perms, 'console.send') || perms.includes('*');
  // Tambah/ubah/hapus player Bedrock menulis file server → butuh files.edit.
  const canEditFiles = permissionsInclude(perms, 'files.edit');

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

  return <PlayerManager serverId={server.id} canSendCommand={canSendCommand} />;
}
