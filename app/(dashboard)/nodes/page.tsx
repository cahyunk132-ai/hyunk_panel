import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { NodeCard } from '@/components/nodes/NodeCard';
import { NewNodeButton } from '@/components/nodes/NewNodeForm';
import { isPanelAdmin } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Nodes' };

export default async function NodesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/dashboard');

  const service = getSupabaseServiceClient();
  const { data: nodes } = await service
    .from('nodes')
    .select('id, name, fqdn, location, is_maintenance, created_at')
    .order('created_at', { ascending: true });

  const { data: servers } = await service.from('servers').select('id, node_id');
  const counts = new Map<string, number>();
  for (const s of servers ?? []) {
    const nid = s.node_id as string;
    counts.set(nid, (counts.get(nid) ?? 0) + 1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Nodes</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            Mesin yang menjalankan Wings. Token node tersimpan terenkripsi (AES-256-GCM).
          </p>
        </div>
        <NewNodeButton />
      </div>

      {(nodes ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-base-850/50 px-6 py-14 text-center">
          <p className="text-sm text-ink-muted">Belum ada node terdaftar.</p>
          <p className="mt-2 text-xs text-ink-faint">
            Jalankan <code className="font-mono text-accent">POST /api/admin/seed</code> untuk mengimpor
            node existing, atau tambah manual.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(nodes ?? []).map((node) => (
            <NodeCard
              key={node.id as string}
              node={{
                id: node.id as string,
                name: node.name as string,
                fqdn: node.fqdn as string,
                location: node.location as string,
                is_maintenance: node.is_maintenance as boolean,
                server_count: counts.get(node.id as string) ?? 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
