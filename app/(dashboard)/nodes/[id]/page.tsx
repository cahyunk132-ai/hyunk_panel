import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { NodeStats } from '@/components/nodes/NodeStats';
import { NodeAllocations } from '@/components/nodes/NodeAllocations';
import { StatusBadge } from '@/components/servers/StatusBadge';
import { NodeAdminActions } from '@/components/nodes/NodeAdminActions';
import { isPanelAdmin } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Detail Node' };

export default async function NodeDetailPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/');

  const service = getSupabaseServiceClient();
  const { data: node } = await service
    .from('nodes')
    .select('id, name, fqdn, port, uuid, location, memory_total_mb, disk_total_mb, is_maintenance, created_at')
    .or(`id.eq.${params.id},uuid.eq.${params.id}`)
    .maybeSingle();
  if (!node) notFound();

  const { data: servers } = await service
    .from('servers')
    .select('id, uuid, name, status, memory_mb, cpu_limit, allocations(port)')
    .eq('node_id', node.id)
    .order('created_at', { ascending: true });

  const isAdmin = isPanelAdmin(user.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">{node.name as string}</h1>
            {node.is_maintenance ? <Badge tone="yellow">Maintenance</Badge> : <Badge tone="green">Aktif</Badge>}
          </div>
          <p className="mt-1 font-mono text-xs text-ink-muted">
            https://{node.fqdn as string}:{node.port as number} · UUID {node.uuid as string}
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">Location: {node.location as string}</p>
        </div>
        {isAdmin && (
          <NodeAdminActions
            node={{
              id: node.id as string,
              name: node.name as string,
              fqdn: node.fqdn as string,
              port: node.port as number,
              location: node.location as string,
              memory_total_mb: (node.memory_total_mb as number | null) ?? null,
              disk_total_mb: (node.disk_total_mb as number | null) ?? null,
            }}
            isMaintenance={node.is_maintenance as boolean}
            serverCount={servers?.length ?? 0}
          />
        )}
      </div>

      {isAdmin ? (
        <NodeStats nodeId={node.id as string} />
      ) : (
        <Card className="px-5 py-4 text-sm text-ink-faint">
          Statistik live node hanya untuk admin.
        </Card>
      )}

      <NodeAllocations nodeId={node.id as string} canManage={isAdmin} />

      <Card>
        <CardHeader title="Server terdaftar di panel" subtitle={`${servers?.length ?? 0} server`} />
        <div className="divide-y divide-line-soft">
          {(servers ?? []).map((s) => {
            const alloc = s.allocations as { port?: number } | { port?: number }[] | null;
            const port = Array.isArray(alloc) ? alloc[0]?.port : alloc?.port;
            return (
              <Link
                key={s.id as string}
                href={`/servers/${s.id}`}
                className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-base-800/60"
              >
                <StatusBadge status={s.status as string} />
                <span className="font-medium text-ink">{s.name as string}</span>
                {port && <span className="font-mono text-[11px] text-ink-faint">:{String(port)}</span>}
                <span className="ml-auto font-mono text-[11px] text-ink-muted">
                  {(s.memory_mb as number) / 1024} GB · {s.cpu_limit as number}% CPU
                </span>
              </Link>
            );
          })}
          {(servers ?? []).length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-ink-faint">Belum ada server di node ini.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
