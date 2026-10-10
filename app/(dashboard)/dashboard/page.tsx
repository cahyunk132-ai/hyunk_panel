import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { Card, CardHeader, StatCard } from '@/components/ui/Card';
import { ServerCard, type ServerCardData } from '@/components/servers/ServerCard';
import { NodeCard } from '@/components/nodes/NodeCard';
import { Badge } from '@/components/ui/Badge';
import { formatRelativeTime } from '@/lib/utils/format';
import { hasPermission } from '@/lib/auth/rbac';
import { isPanelAdmin } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role === 'user' || user.role === 'subuser') redirect('/servers');

  const service = getSupabaseServiceClient();
  const canManagePanel = isPanelAdmin(user.role);
  const canSeeAllServers = canManagePanel || user.role === 'moderator';
  const canViewAudit = await hasPermission(user, 'audit_log');

  let serversQuery = service
    .from('servers')
    .select('*, nodes(name, fqdn), allocations(ip, port)')
    .order('created_at', { ascending: true });
  if (!canSeeAllServers) {
    const { data: assigned } = await service
      .from('server_users')
      .select('server_id')
      .eq('user_id', user.id);
    const ids = (assigned ?? []).map((row) => row.server_id as string);
    serversQuery = ids.length > 0 ? serversQuery.in('id', ids) : serversQuery.limit(0);
  }

  const [
    { data: servers },
    { count: nodeCount },
    { data: nodes },
    { count: userCount },
    { data: recentActivity },
  ] = await Promise.all([
    serversQuery,
    canManagePanel
      ? service.from('nodes').select('id', { count: 'exact', head: true })
      : Promise.resolve({ count: null }),
    canManagePanel
      ? service
          .from('nodes')
          .select('id, name, fqdn, location, is_maintenance')
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    canManagePanel
      ? service.from('users').select('id', { count: 'exact', head: true })
      : Promise.resolve({ count: null }),
    canViewAudit
      ? service
          .from('activity_logs')
          .select('id, action, metadata, created_at, users(username), servers(name)')
          .order('created_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [] }),
  ]);

  const serverList = (servers ?? []) as ServerCardData[];
  const running = serverList.filter((server) => server.status === 'running').length;
  const serverCountsByNode = new Map<string, number>();
  for (const server of servers ?? []) {
    const nodeId = (server as { node_id?: string }).node_id;
    if (nodeId) serverCountsByNode.set(nodeId, (serverCountsByNode.get(nodeId) ?? 0) + 1);
  }
  const totalRamMb = serverList.reduce((total, server) => total + server.memory_mb, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Dashboard</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Selamat datang, <span className="text-accent">{user.username}</span>. Ringkasan infrastruktur Anda.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {canManagePanel && <StatCard label="Nodes" value={nodeCount ?? 0} hint="node terdaftar di panel" />}
        <StatCard label="Servers" value={serverList.length} hint={`${running} running`} />
        <StatCard
          label="Total RAM"
          value={`${(totalRamMb / 1024).toFixed(1)} GB`}
          hint="teralokasi ke server"
        />
        {canManagePanel && <StatCard label="Users" value={userCount ?? 0} hint="akun panel" />}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Servers</h2>
            <Link href="/servers" className="text-xs text-accent hover:underline">
              Lihat semua →
            </Link>
          </div>
          {serverList.length === 0 ? (
            <Card className="px-6 py-10 text-center">
              <p className="text-sm text-ink-muted">Belum ada server.</p>
              {canManagePanel && (
                <p className="mt-1 text-xs text-ink-faint">
                  Jalankan seed: <code className="rounded bg-base-700 px-1.5 py-0.5 font-mono">POST /api/admin/seed</code>
                </p>
              )}
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {serverList.slice(0, 6).map((server) => (
                <ServerCard key={server.id} server={server} />
              ))}
            </div>
          )}

          {canManagePanel && (
            <>
              <div className="flex items-center justify-between pt-2">
                <h2 className="text-sm font-semibold">Nodes</h2>
                <Link href="/nodes" className="text-xs text-accent hover:underline">
                  Kelola →
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {(nodes ?? []).map((node) => (
                  <NodeCard
                    key={node.id as string}
                    node={{
                      id: node.id as string,
                      name: node.name as string,
                      fqdn: node.fqdn as string,
                      location: node.location as string,
                      is_maintenance: node.is_maintenance as boolean,
                      server_count: serverCountsByNode.get(node.id as string) ?? 0,
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {canViewAudit && (
          <Card className="h-fit">
            <CardHeader title="Aktivitas terbaru" subtitle="Log panel & wings" />
            <div className="divide-y divide-line-soft">
              {(recentActivity ?? []).length === 0 && (
                <p className="px-5 py-6 text-center text-xs text-ink-faint">Belum ada aktivitas.</p>
              )}
              {(recentActivity ?? []).map((log) => {
                const actor = log.users as { username?: string } | null;
                const server = log.servers as { name?: string } | null;
                return (
                  <div key={log.id as string} className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-base-700 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                        {log.action as string}
                      </code>
                      {server?.name && <Badge tone="default">{server.name}</Badge>}
                    </div>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {actor?.username ?? 'system'} · {formatRelativeTime(log.created_at as string)}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
