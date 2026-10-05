import { NextRequest } from 'next/server';
import { requireAdmin, requireUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { encryptToken } from '@/lib/wings/crypto';
import { getNodeById, logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

const NODE_PUBLIC_SELECT =
  'id, name, fqdn, port, uuid, location, memory_total_mb, disk_total_mb, is_maintenance, created_at';

/** GET /api/nodes/{id} — detail node + jumlah server yang terdaftar di panel. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const service = getSupabaseServiceClient();
  const { data: node } = await service
    .from('nodes')
    .select(NODE_PUBLIC_SELECT)
    .or(`id.eq.${params.id},uuid.eq.${params.id}`)
    .maybeSingle();
  if (!node) return Response.json({ error: 'Node tidak ditemukan' }, { status: 404 });

  const { count } = await service
    .from('servers')
    .select('id', { count: 'exact', head: true })
    .eq('node_id', node.id);

  const { data: servers } = await service
    .from('servers')
    .select('id, uuid, name, status, memory_mb, cpu_limit, is_suspended')
    .eq('node_id', node.id)
    .order('created_at', { ascending: true });

  return Response.json({ node, servers: servers ?? [], server_count: count ?? 0 });
}

/** PATCH /api/nodes/{id} — update node (admin). Token hanya diganti bila dikirim. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const existing = await getNodeById(params.id);
  if (!existing) return Response.json({ error: 'Node tidak ditemukan' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  const allowed = [
    'name',
    'fqdn',
    'port',
    'location',
    'memory_total_mb',
    'disk_total_mb',
    'is_maintenance',
    'token_id',
  ] as const;
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }
  if (typeof body.token === 'string' && body.token.length > 0) {
    update.token_encrypted = encryptToken(body.token);
  }

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'Tidak ada field yang diubah' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('nodes')
    .update(update)
    .eq('id', existing.id)
    .select(NODE_PUBLIC_SELECT)
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: admin.id,
    action: 'node:update',
    metadata: { node: existing.name, fields: Object.keys(update).filter((k) => k !== 'token_encrypted') },
  });
  return Response.json({ node: data });
}

/** DELETE /api/nodes/{id} — hapus node dari panel PANEL SAJA (tidak menyentuh mesin). */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const existing = await getNodeById(params.id);
  if (!existing) return Response.json({ error: 'Node tidak ditemukan' }, { status: 404 });

  const service = getSupabaseServiceClient();
  const { count } = await service
    .from('servers')
    .select('id', { count: 'exact', head: true })
    .eq('node_id', existing.id);
  const force = request.nextUrl.searchParams.get('force') === 'true';
  if ((count ?? 0) > 0 && !force) {
    return Response.json(
      { error: `Node masih memiliki ${count} server. Gunakan ?force=true untuk tetap menghapus dari panel.` },
      { status: 409 },
    );
  }

  const { error } = await service.from('nodes').delete().eq('id', existing.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({ userId: admin.id, action: 'node:delete', metadata: { node: existing.name } });
  return Response.json({ ok: true });
}
