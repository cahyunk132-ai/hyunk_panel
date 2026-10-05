import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { ActivityTable, type ActivityItem } from '@/components/activity/ActivityTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Aktivitas Server' };

/** Riwayat aksi untuk satu server (panel + wings). */
export default async function ServerActivityPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const result = await checkPermission(user, 'console', params.id);
  if (result instanceof Response) notFound();

  const service = getSupabaseServiceClient();
  const { data } = await service
    .from('activity_logs')
    .select('id, action, metadata, ip, created_at, server_id, users(username), servers(name)')
    .eq('server_id', result.server.id)
    .order('created_at', { ascending: false })
    .limit(100);

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

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        100 aktivitas terakhir untuk <strong className="text-ink">{result.server.name}</strong>{' '}
        (aksi panel + event yang dilaporkan Wings).
      </p>
      <ActivityTable items={items} />
    </div>
  );
}
