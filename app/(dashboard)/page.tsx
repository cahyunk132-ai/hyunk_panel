import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { Card, CardHeader, StatCard } from '@/components/ui/Card';
import { ServerCard, type ServerCardData } from '@/components/servers/ServerCard';
import { NodeCard } from '@/components/nodes/NodeCard';
import { Badge } from '@/components/ui/Badge';
import { formatRelativeTime } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const service = getSupabaseServiceClient();

  const isAdmin = user.role === 'admin';

  // Server yang bisa dilihat user
  let serversQuery = service
    .from('servers')
    .select('*, nodes(name, fqdn), allocations(ip, port)')
    .order('created_at', { ascending: true });
  if (!isAdmin) {
    const { data: assigned } = await service
      .from('server_users')
      .select('server_id')
      .eq('user_id', user.id);
    const ids = (assigned ?? []).map((r) => r.server_id as string);
    serversQuery = serversQuery.or(
      ids.length > 0 ? `owner_id.eq.${user.id},id.in.(${ids.join(',')})` : `owner_id.eq.${user.id}`,
    );
  }
  const { data: servers } = await serversQuery;
  const serverList = (servers ?? []) as ServerCardData[];

  const running = serverList.filter((s) => s.status === 'running').length;

  const { count: nodeCount } = await service
    .from('nodes')
    .select('id', { count: 'exact', head: true });
  const { data: nodes } = await service
    .from('nodes')
    .select('id, name, fqdn, location, is_maintenance')
    .order('created_at', { ascending: true });
  const serverCountsByNode = new Map<string, number>();
  for (const s of servers ?? []) {
    const nid = (s as { node_id?: string }).node_id;
    if (nid) serverCountsByNode.set(nid, (serverCountsByNode.get(nid) ?? 0) + 1);
  }
  const { count: userCount } = isAdmin
    ? await service.from('users').select('id', { count: 'exact', head: true })
    : { count: null };

  const { data: recentActivity } = await service
    .from('activity_logs')
    .select('id, action, metadata, created_at, users(username), servers(name)')
    .order('created_at', { ascending: false })
    .limit(8);

  const totalRamMb = serverList.reduce((acc, s) => acc + s.memory_mb, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Dashboard</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Selamat datang, <span className="text-accent">{user.username}</span>. Ringkasan infrastruktur Anda.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Nodes" value={nodeCount ?? 0} hint="node terdaftar di panel" />
        <StatCard label="Servers" value={serverList.length} hint={`${running} running`} />
        <StatCard
          label="Total RAM"
          value={`${(totalRamMb / 1024).toFixed(1)} GB`}
          hint="teralokasi ke server"
        />
        <StatCard label="Users" value={isAdmin ? (userCount ?? 0) : '—'} hint={isAdmin ? 'akun panel' : 'khusus admin'} />
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
              <p className="mt-1 text-xs text-ink-faint">
                Jalankan seed: <code className="rounded bg-base-700 px-1.5 py-0.5 font-mono">curl -X POST /api/admin/seed -H "cookie: ..."</code>
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {serverList.slice(0, 6).map((server) => (
                <ServerCard key={server.id} server={server} />
              ))}
            </div>
          )}

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
        </div>

        <Card className="h-fit">
          <CardHeader title="Aktivitas terbaru" subtitle="Log panel & wings" />
          <div className="divide-y divide-line-soft">
            {(recentActivity ?? []).length === 0 && (
              <p className="px-5 py-6 text-center text-xs text-ink-faint">Belum ada aktivitas.</p>
            )}
            {(recentActivity ?? []).map((log) => {
              const u = log.users as { username?: string } | null;
              const s = log.servers as { name?: string } | null;
              return (
                <div key={log.id as string} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-base-700 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                      {log.action as string}
                    </code>
                    {s?.name && <Badge tone="default">{s.name}</Badge>}
                  </div>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    {u?.username ?? 'system'} · {formatRelativeTime(log.created_at as string)}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
