import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { ActivityTable, type ActivityItem } from '@/components/activity/ActivityTable';
import { Input, Select } from '@/components/ui/Input';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Audit Log' };

const PAGE_SIZE = 50;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: { action?: string; server?: string; page?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');

  const page = Math.max(parseInt(searchParams.page ?? '1', 10) || 1, 1);
  const actionFilter = (searchParams.action ?? '').trim();
  const serverFilter = (searchParams.server ?? '').trim();

  const service = getSupabaseServiceClient();

  let query = service
    .from('activity_logs')
    .select('id, action, metadata, ip, created_at, server_id, users(username), servers(name)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false });

  if (actionFilter) query = query.ilike('action', `%${actionFilter}%`);
  if (serverFilter) query = query.eq('server_id', serverFilter);

  const { data, count } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const items: ActivityItem[] = (data ?? []).map((row) => ({
    id: row.id as string,
    action: row.action as string,
    created_at: row.created_at as string,
    ip: (row.ip as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    server_id: (row.server_id as string | null) ?? null,
    username: (row.users as { username?: string } | null)?.username ?? null,
    server_name: (row.servers as { name?: string } | null)?.name ?? null,
  }));

  const { data: servers } = await service.from('servers').select('id, name').order('name');
  const totalPages = Math.max(Math.ceil((count ?? 0) / PAGE_SIZE), 1);

  function pageUrl(p: number): string {
    const params = new URLSearchParams();
    if (actionFilter) params.set('action', actionFilter);
    if (serverFilter) params.set('server', serverFilter);
    params.set('page', String(p));
    return `/activity?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Audit Log</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Jejak semua aksi panel dan event yang dilaporkan Wings. {count ?? 0} entri.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[11px] text-ink-faint">Aksi mengandung…</label>
          <Input name="action" defaultValue={actionFilter} placeholder="power:start" className="w-48" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-ink-faint">Server</label>
          <Select name="server" defaultValue={serverFilter} className="w-52">
            <option value="">Semua server</option>
            {(servers ?? []).map((s) => (
              <option key={s.id as string} value={s.id as string}>
                {s.name as string}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-base-900 hover:bg-accent-dim"
        >
          Filter
        </button>
        {(actionFilter || serverFilter) && (
          <Link href="/activity" className="px-2 py-2 text-sm text-ink-muted hover:text-ink">
            Reset
          </Link>
        )}
      </form>

      <ActivityTable items={items} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Link
            href={pageUrl(Math.max(page - 1, 1))}
            aria-disabled={page <= 1}
            className={`rounded-lg border border-line px-3 py-1.5 ${
              page <= 1 ? 'pointer-events-none opacity-40' : 'text-ink-muted hover:text-ink'
            }`}
          >
            ← Lebih baru
          </Link>
          <span className="text-xs text-ink-faint">
            Halaman {page} / {totalPages}
          </span>
          <Link
            href={pageUrl(Math.min(page + 1, totalPages))}
            aria-disabled={page >= totalPages}
            className={`rounded-lg border border-line px-3 py-1.5 ${
              page >= totalPages ? 'pointer-events-none opacity-40' : 'text-ink-muted hover:text-ink'
            }`}
          >
            Lebih lama →
          </Link>
        </div>
      )}
    </div>
  );
}
