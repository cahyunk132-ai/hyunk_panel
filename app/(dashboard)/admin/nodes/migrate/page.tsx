import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { NodesMigrate } from '@/components/admin/NodesMigrate';
import type { PublicNode } from '@/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Migrasi Node' };

/** Halaman migrasi node — khusus Owner Panel & Admin. */
export default async function AdminNodesMigratePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/dashboard');

  const service = getSupabaseServiceClient();
  const { data: nodes } = await service
    .from('nodes')
    .select('id, name, fqdn, location, is_maintenance, created_at')
    .order('created_at', { ascending: true });

  const publicNodes = (nodes ?? []) as unknown as PublicNode[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Migrasi Node</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            Pindahkan server dari satu node ke node lain beserta update DNS Cloudflare.
          </p>
        </div>
      </div>

      <NodesMigrate nodes={publicNodes} />
    </div>
  );
}
