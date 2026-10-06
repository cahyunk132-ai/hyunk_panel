import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getEffectivePermissions, getServerByIdOrUuid, permissionsInclude } from '@/lib/auth/rbac';
import { PluginDownloader } from '@/components/servers/PluginDownloader';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Plugins' };

export default async function PluginsPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();
  const perms = await getEffectivePermissions(user, server);
  if (!permissionsInclude(perms, 'files.read')) notFound();

  if (!server.image.toLowerCase().includes('java')) {
    return (
      <div className="rounded-xl border border-line bg-base-850 px-5 py-10 text-center">
        <p className="text-sm text-ink-muted">Fitur ini hanya tersedia untuk Java Edition</p>
      </div>
    );
  }

  return (
    <PluginDownloader
      serverId={server.id}
      minecraftVersion={server.env?.MINECRAFT_VERSION?.trim() ?? ''}
      canInstall={permissionsInclude(perms, 'files.edit')}
    />
  );
}
