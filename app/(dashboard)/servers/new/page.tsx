import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { NewServerForm } from '@/components/servers/NewServerForm';
import { isPanelAdmin } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Server Baru' };

export default async function NewServerPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/servers');

  const service = getSupabaseServiceClient();
  const { data: nodes } = await service
    .from('nodes')
    .select('id, name, fqdn')
    .order('created_at', { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Server baru</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Mendaftarkan server baru di panel. Hanya Owner Panel atau Admin.
        </p>
      </div>
      {(nodes ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-base-850/50 px-6 py-10 text-center text-sm text-ink-faint">
          Daftarkan node dulu (seed atau menu Nodes).
        </p>
      ) : (
        <NewServerForm nodes={(nodes ?? []) as Array<{ id: string; name: string; fqdn: string }>} />
      )}
    </div>
  );
}
