import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { BASE_DOMAIN } from '@/lib/subdomains';
import type { AdminSubdomainRow, ServerSubdomainRow } from '@/types';

export const runtime = 'nodejs';

const SUBDOMAIN_COLUMNS = 'id, server_id, subdomain, full_domain, port, created_at, updated_at';

/**
 * GET /api/admin/subdomains — daftar SEMUA subdomain yang terdaftar di panel
 * (Owner Panel & Admin). Query memakai SERVICE ROLE (bypass RLS), join ke
 * `servers` (nama server) dan `users` (owner).
 *
 * Query params:
 *   q = cari subdomain / nama server / username / email owner (opsional)
 */
export async function GET(request: NextRequest) {
  const user = await requireAdmin();
  if (user instanceof Response) return user;

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  const service = getSupabaseServiceClient();

  const { data, error } = await service
    .from('server_subdomains')
    .select(`${SUBDOMAIN_COLUMNS}, servers!inner(id, name, uuid, owner_id)`)
    .order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  type JoinedRow = ServerSubdomainRow & {
    servers: { id: string; name: string; uuid: string; owner_id: string | null } | null;
  };
  const rows = (data ?? []) as unknown as JoinedRow[];

  // Profil owner dalam satu query (relasi users tidak selalu bisa di-embed dua level).
  const ownerIds = Array.from(
    new Set(rows.map((row) => row.servers?.owner_id).filter((id): id is string => !!id)),
  );
  const owners = new Map<string, { username: string | null; email: string | null }>();
  if (ownerIds.length > 0) {
    const { data: ownerRows } = await service
      .from('users')
      .select('id, username, email')
      .in('id', ownerIds);
    for (const owner of (ownerRows ?? []) as Array<{ id: string; username: string | null; email: string | null }>) {
      owners.set(owner.id, { username: owner.username, email: owner.email });
    }
  }

  let mapped: AdminSubdomainRow[] = rows.map((row) => {
    const owner = row.servers?.owner_id ? owners.get(row.servers.owner_id) : undefined;
    return {
      id: row.id,
      server_id: row.server_id,
      subdomain: row.subdomain,
      full_domain: row.full_domain,
      port: row.port,
      created_at: row.created_at,
      updated_at: row.updated_at,
      server_name: row.servers?.name ?? null,
      server_uuid: row.servers?.uuid ?? null,
      owner_id: row.servers?.owner_id ?? null,
      owner_username: owner?.username ?? null,
      owner_email: owner?.email ?? null,
    };
  });

  if (q) {
    mapped = mapped.filter((row) =>
      [row.subdomain, row.full_domain, row.server_name, row.owner_username, row.owner_email]
        .filter(Boolean)
        .some((value) => (value as string).toLowerCase().includes(q)),
    );
  }

  return Response.json({
    subdomains: mapped,
    total: mapped.length,
    base_domain: BASE_DOMAIN,
  });
}
