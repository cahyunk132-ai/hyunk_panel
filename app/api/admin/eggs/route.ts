import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';
import { parseEggFields, isJsonObject, parseNodeIds } from '@/lib/eggs/validation';
import { replaceEggNodeAssignments } from '@/lib/eggs/node-assignments';

export const runtime = 'nodejs';

/** GET /api/admin/eggs — egg templates, version counts, and node assignments. */
export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const service = getSupabaseServiceClient();
  const { data: eggs, error } = await service.from('eggs').select('*').order('name');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!eggs?.length) return Response.json({ eggs: [] });

  const ids = eggs.map((egg) => egg.id as string);
  const [{ data: versions, error: versionsError }, { data: assignments, error: assignmentsError }] =
    await Promise.all([
      service.from('egg_versions').select('id, egg_id').in('egg_id', ids),
      service.from('node_eggs').select('egg_id, node_id').in('egg_id', ids),
    ]);
  if (versionsError || assignmentsError) {
    return Response.json({ error: versionsError?.message ?? assignmentsError?.message }, { status: 500 });
  }

  const versionCounts = new Map<string, number>();
  for (const version of versions ?? []) {
    const eggId = version.egg_id as string;
    versionCounts.set(eggId, (versionCounts.get(eggId) ?? 0) + 1);
  }
  const nodeIdsByEgg = new Map<string, string[]>();
  for (const assignment of assignments ?? []) {
    const eggId = assignment.egg_id as string;
    nodeIdsByEgg.set(eggId, [...(nodeIdsByEgg.get(eggId) ?? []), assignment.node_id as string]);
  }

  return Response.json({
    eggs: eggs.map((egg) => ({
      ...egg,
      versions_count: versionCounts.get(egg.id as string) ?? 0,
      node_ids: nodeIdsByEgg.get(egg.id as string) ?? [],
    })),
  });
}

/** POST /api/admin/eggs — create an Egg template manually. */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = await request.json().catch(() => null);
  if (!isJsonObject(body)) return Response.json({ error: 'Body harus berupa object JSON.' }, { status: 400 });

  const parsed = parseEggFields(body);
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

  const service = getSupabaseServiceClient();
  const { data: egg, error } = await service
    .from('eggs')
    .insert({ ...parsed.fields, created_by: admin.id })
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (nodeIds) {
    const assignmentError = await replaceEggNodeAssignments(service, egg.id as string, nodeIds);
    if (assignmentError) {
      await service.from('eggs').delete().eq('id', egg.id);
      return Response.json({ error: `Egg tidak dapat di-assign ke node: ${assignmentError}` }, { status: 400 });
    }
  }

  await logActivity({ userId: admin.id, action: 'egg:create', metadata: { egg_id: egg.id, name: egg.name } });
  return Response.json({ egg: { ...egg, node_ids: nodeIds ?? [], versions_count: 0 } }, { status: 201 });
}
