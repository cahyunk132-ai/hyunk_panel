import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getEffectivePermissions, getServerByIdOrUuid, permissionsInclude } from '@/lib/auth/rbac';
import { isBedrockServer } from '@/lib/minecraft/playerdata';
import { BedrockAddonManager } from '@/components/servers/BedrockAddonManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bedrock Addons' };

export default async function BedrockAddonsPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();
  const permissions = await getEffectivePermissions(user, server);
  if (!permissionsInclude(permissions, 'files.read')) notFound();
  if (!isBedrockServer(server)) notFound();

  return (
    <BedrockAddonManager
      serverId={server.id}
      canInstall={permissionsInclude(permissions, 'files.edit')}
    />
  );
}
