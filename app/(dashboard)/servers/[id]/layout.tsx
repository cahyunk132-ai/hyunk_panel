import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getServerByIdOrUuid, getEffectivePermissions, permissionsInclude } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { isBedrockServer } from '@/lib/minecraft/playerdata';
import { StatusBadge } from '@/components/servers/StatusBadge';
import { ServerTabs } from '@/components/servers/ServerTabs';
import { Badge } from '@/components/ui/Badge';

export const dynamic = 'force-dynamic';

export default async function ServerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();

  const perms = await getEffectivePermissions(user, server);
  if (perms.length === 0) notFound(); // 404 — jangan bocorkan eksistensi server

  const service = getSupabaseServiceClient();
  const [{ data: node }, { data: allocation }] = await Promise.all([
    service.from('nodes').select('name, fqdn').eq('id', server.node_id).maybeSingle(),
    server.allocation_id
      ? service.from('allocations').select('ip, port').eq('id', server.allocation_id).maybeSingle()
      : Promise.resolve({ data: null } as const),
  ]);

  const canEditFiles = permissionsInclude(perms, 'files.edit');

  // Allocation menyimpan 0.0.0.0 (wildcard listen) — tampilkan FQDN node agar
  // player bisa connect langsung. Fallback ke IP allocation bila node tak ada.
  const allocIp = allocation?.ip as string | undefined;
  const allocPort = allocation?.port as number | undefined;
  const displayHost =
    allocIp && allocIp !== '0.0.0.0'
      ? allocIp
      : ((node?.fqdn as string | undefined) ?? allocIp);
  const address =
    displayHost && allocPort !== undefined ? `${displayHost}:${allocPort}` : null;

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/servers" className="text-ink-faint transition-colors hover:text-ink" title="Kembali">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-lg font-bold">{server.name}</h1>
            <StatusBadge status={server.is_suspended ? 'error' : server.status} />
            {server.is_suspended && <Badge tone="red">Suspended</Badge>}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">
            {server.uuid}
            {node && ` · ${node.name as string}`}
            {address && ` · ${address}`}
          </p>
        </div>
        <Badge tone={canEditFiles ? 'default' : 'gray'}>
          {perms.includes('*') ? 'full access' : perms.join(', ')}
        </Badge>
      </div>

      <ServerTabs
        serverId={server.id}
        showPlugins={server.image.toLowerCase().includes('java')}
        showBedrockAddons={isBedrockServer(server)}
      />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
