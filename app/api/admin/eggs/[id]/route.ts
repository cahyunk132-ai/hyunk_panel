import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';
import { isJsonObject, parseEggFields, parseNodeIds } from '@/lib/eggs/validation';
import { replaceEggNodeAssignments } from '@/lib/eggs/node-assignments';

export const runtime = 'nodejs';

/** GET /api/admin/eggs/{id} — egg details, versions, and assigned node IDs. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const service = getSupabaseServiceClient();
  const { data: egg, error } = await service.from('eggs').select('*').eq('id', params.id).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!egg) return Response.json({ error: 'Egg tidak ditemukan.' }, { status: 404 });

  const [{ data: versions, error: versionsError }, { data: assignments, error: assignmentsError }] =
    await Promise.all([
      service
        .from('egg_versions')
        .select('*')
        .eq('egg_id', params.id)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      service.from('node_eggs').select('node_id').eq('egg_id', params.id),
    ]);
  if (versionsError || assignmentsError) {
    return Response.json({ error: versionsError?.message ?? assignmentsError?.message }, { status: 500 });
  }
  return Response.json({ egg: { ...egg, versions: versions ?? [], node_ids: (assignments ?? []).map((row) => row.node_id) } });
}

/** PATCH /api/admin/eggs/{id} — edit Egg data and/or node assignments. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = await request.json().catch(() => null);
  if (!isJsonObject(body)) return Response.json({ error: 'Body harus berupa object JSON.' }, { status: 400 });
  const parsed = parseEggFields(body, true);
  if (parsed.error || !parsed.fields) {
    return Response.json({ error: parsed.error ?? 'Data egg tidak valid.' }, { status: 400 });
  }

  let nodeIds: string[] | undefined;
  if (body.node_ids !== undefined) {
    const parsedNodes = parseNodeIds(body.node_ids);
    if (parsedNodes.error || !parsedNodes.ids) {
      return Response.json({ error: parsedNodes.error ?? 'Daftar node tidak valid.' }, { status: 400 });
    }
    nodeIds = parsedNodes.ids;
  }
  if (Object.keys(parsed.fields).length === 0 && nodeIds === undefined) {
    return Response.json({ error: 'Tidak ada field yang diubah.' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data: existing, error: lookupError } = await service
    .from('eggs')
    .select('id, name')
    .eq('id', params.id)
    .maybeSingle();
  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (!existing) return Response.json({ error: 'Egg tidak ditemukan.' }, { status: 404 });

  let egg = existing;
  if (Object.keys(parsed.fields).length > 0) {
    const { data, error } = await service
      .from('eggs')
      .update(parsed.fields)
      .eq('id', params.id)
      .select('*')
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    egg = data;
  }

  if (nodeIds !== undefined) {
    const assignmentError = await replaceEggNodeAssignments(service, params.id, nodeIds);
    if (assignmentError) {
      return Response.json(
        { error: `Data egg tersimpan, tetapi assignment node gagal: ${assignmentError}` },
        { status: 400 },
      );
    }
  }

  await logActivity({
    userId: admin.id,
    action: 'egg:update',
    metadata: { egg_id: params.id, fields: Object.keys(parsed.fields), node_assignments_updated: nodeIds !== undefined },
  });
  return Response.json({ egg: { ...egg, ...(nodeIds !== undefined ? { node_ids: nodeIds } : {}) } });
}

/** DELETE /api/admin/eggs/{id} — delete template, its versions, and node assignments. */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const service = getSupabaseServiceClient();
  const { data: existing, error: lookupError } = await service
    .from('eggs')
    .select('id, name')
    .eq('id', params.id)
    .maybeSingle();
  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (!existing) return Response.json({ error: 'Egg tidak ditemukan.' }, { status: 404 });

  const { error } = await service.from('eggs').delete().eq('id', params.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logActivity({ userId: admin.id, action: 'egg:delete', metadata: { egg_id: params.id, name: existing.name } });
  return Response.json({ ok: true });
}
