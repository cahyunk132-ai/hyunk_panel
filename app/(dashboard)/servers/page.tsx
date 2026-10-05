import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { ServerCard, type ServerCardData } from '@/components/servers/ServerCard';
import { Button } from '@/components/ui/Button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Servers' };

export default async function ServersPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const isAdmin = user.role === 'admin';

  const service = getSupabaseServiceClient();
  let query = service
    .from('servers')
    .select('*, nodes(name, fqdn), allocations(ip, port)')
    .order('created_at', { ascending: true });

  if (!isAdmin) {
    const { data: assigned } = await service
      .from('server_users')
      .select('server_id')
      .eq('user_id', user.id);
    const ids = (assigned ?? []).map((r) => r.server_id as string);
    query = query.or(
      ids.length > 0 ? `owner_id.eq.${user.id},id.in.(${ids.join(',')})` : `owner_id.eq.${user.id}`,
    );
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
        {isAdmin && (
          <Link href="/servers/new">
            <Button size="sm">+ Server baru</Button>
          </Link>
        )}
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-base-850/50 px-6 py-14 text-center">
          <p className="text-sm text-ink-muted">
            {isAdmin ? 'Belum ada server.' : 'Belum ada server yang di-assign ke akun Anda.'}
          </p>
          {isAdmin && (
            <p className="mt-2 text-xs text-ink-faint">
              Jalankan <code className="font-mono text-accent">POST /api/admin/seed</code> untuk
              mengimpor 5 server existing dari node.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}
