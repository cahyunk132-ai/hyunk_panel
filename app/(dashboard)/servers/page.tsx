import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { ServerCard, type ServerCardData } from '@/components/servers/ServerCard';
import { Button } from '@/components/ui/Button';
import { isPanelAdmin } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Servers' };

export default async function ServersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const canManageServers = isPanelAdmin(user.role);
  const canSeeAllServers = canManageServers || user.role === 'moderator';

  const service = getSupabaseServiceClient();
  let query = service
    .from('servers')
    .select('*, nodes(name, fqdn), allocations(ip, port)')
    .order('created_at', { ascending: true });

  if (!canSeeAllServers) {
    const { data: assigned } = await service
      .from('server_users')
      .select('server_id')
      .eq('user_id', user.id);
    const ids = (assigned ?? []).map((r) => r.server_id as string);
    query = ids.length > 0 ? query.in('id', ids) : query.limit(0);
  }

  const { data: servers } = await query;
  const list = (servers ?? []) as ServerCardData[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Servers</h1>
          <p className="mt-0.5 text-sm text-ink-muted">{list.length} server</p>
        </div>
        {canManageServers && (
          <Link href="/servers/new">
            <Button size="sm">+ Server baru</Button>
          </Link>
        )}
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-base-850/50 px-6 py-14 text-center">
          <p className="text-sm text-ink-muted">
            {canSeeAllServers ? 'Belum ada server.' : 'Belum ada server yang di-assign ke akun Anda.'}
          </p>
          {canManageServers && (
            <p className="mt-2 text-xs text-ink-faint">
              Jalankan <code className="font-mono text-accent">POST /api/admin/seed</code> untuk
              mengimpor 5 server existing dari node.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}
