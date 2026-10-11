import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';
import type { ServerSubdomainRow } from '@/types';

export const runtime = 'nodejs';

const SUBDOMAIN_COLUMNS = 'id, server_id, subdomain, full_domain, port, created_at, updated_at';

/** DELETE /api/admin/subdomains/{id} — hapus subdomain mana pun (Owner Panel & Admin). */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdmin();
  if (user instanceof Response) return user;

  const service = getSupabaseServiceClient();
  const { data: removed, error } = await service
    .from('server_subdomains')
    .delete()
    .eq('id', params.id)
    .select(SUBDOMAIN_COLUMNS)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!removed) return Response.json({ error: 'Subdomain tidak ditemukan' }, { status: 404 });

  const row = removed as ServerSubdomainRow;
  await logActivity({
    userId: user.id,
    serverId: row.server_id,
    action: 'server:subdomain-remove',
    metadata: {
      subdomain: row.subdomain,
      full_domain: row.full_domain,
      port: row.port,
      via: 'admin',
    },
  });

  return Response.json({
    ok: true,
    message: `Subdomain ${row.full_domain} dihapus`,
  });
}
