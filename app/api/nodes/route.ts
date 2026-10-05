import { NextRequest } from 'next/server';
import { requireAdmin, requireUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { encryptToken } from '@/lib/wings/crypto';
import { logActivity } from '@/lib/wings/resolve';
import type { NodeRow } from '@/types';

export const runtime = 'nodejs';

const NODE_PUBLIC_SELECT =
  'id, name, fqdn, port, uuid, location, memory_total_mb, disk_total_mb, is_maintenance, created_at';

/** GET /api/nodes — daftar node (tanpa token, aman untuk semua user login). */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('nodes')
    .select(NODE_PUBLIC_SELECT)
    .order('created_at', { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ nodes: data });
}

/**
 * POST /api/nodes — tambah node baru (admin).
 * Body: { name, fqdn, port?, uuid, token_id, token, location?, memory_total_mb?, disk_total_mb? }
 * `token` mentah diterima via request (bukan hardcode) dan langsung dienkripsi.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body bukan JSON valid' }, { status: 400 });
  }

  const { name, fqdn, port, uuid, token_id, token, location, memory_total_mb, disk_total_mb } =
    body as {
      name?: string;
      fqdn?: string;
      port?: number;
      uuid?: string;
      token_id?: string;
      token?: string;
      location?: string;
      memory_total_mb?: number;
      disk_total_mb?: number;
    };

  if (!name || !fqdn || !uuid || !token_id || !token) {
    return Response.json(
      { error: 'Field wajib: name, fqdn, uuid, token_id, token' },
      { status: 400 },
    );
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('nodes')
    .insert({
      name,
      fqdn,
      port: typeof port === 'number' ? port : 8080,
      uuid,
      token_id,
      token_encrypted: encryptToken(token),
      location: location ?? 'ID',
      memory_total_mb: memory_total_mb ?? null,
      disk_total_mb: disk_total_mb ?? null,
    })
    .select(NODE_PUBLIC_SELECT)
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: error.code === '23505' ? 409 : 500 });
  }

  await logActivity({ userId: admin.id, action: 'node:create', metadata: { node: name, fqdn } });
  return Response.json({ node: data as Partial<NodeRow> }, { status: 201 });
}
