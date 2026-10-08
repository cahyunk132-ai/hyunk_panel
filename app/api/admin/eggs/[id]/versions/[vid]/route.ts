import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';
import { isJsonObject, parseVersionFields } from '@/lib/eggs/validation';

export const runtime = 'nodejs';

/** PATCH /api/admin/eggs/{id}/versions/{vid} — update a version. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string; vid: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = await request.json().catch(() => null);
  if (!isJsonObject(body)) return Response.json({ error: 'Body harus berupa object JSON.' }, { status: 400 });
  const parsed = parseVersionFields(body, true);
  if (parsed.error || !parsed.fields) {
    return Response.json({ error: parsed.error ?? 'Data versi tidak valid.' }, { status: 400 });
  }
  if (Object.keys(parsed.fields).length === 0) {
    return Response.json({ error: 'Tidak ada field yang diubah.' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data: existing, error: lookupError } = await service
    .from('egg_versions')
    .select('id')
    .eq('id', params.vid)
    .eq('egg_id', params.id)
    .maybeSingle();
  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (!existing) return Response.json({ error: 'Versi egg tidak ditemukan.' }, { status: 404 });

  const { data: version, error } = await service
    .from('egg_versions')
    .update(parsed.fields)
    .eq('id', params.vid)
    .eq('egg_id', params.id)
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (version.is_recommended) {
    await service
      .from('egg_versions')
      .update({ is_recommended: false })
      .eq('egg_id', params.id)
      .neq('id', params.vid);
  }

  await logActivity({
    userId: admin.id,
    action: 'egg:version-update',
    metadata: { egg_id: params.id, version_id: params.vid, fields: Object.keys(parsed.fields) },
  });
  return Response.json({ version });
}

/** DELETE /api/admin/eggs/{id}/versions/{vid} — remove a version. */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string; vid: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const service = getSupabaseServiceClient();
  const { data: existing, error: lookupError } = await service
    .from('egg_versions')
    .select('id, name')
    .eq('id', params.vid)
    .eq('egg_id', params.id)
    .maybeSingle();
  if (lookupError) return Response.json({ error: lookupError.message }, { status: 500 });
  if (!existing) return Response.json({ error: 'Versi egg tidak ditemukan.' }, { status: 404 });

  const { error } = await service
    .from('egg_versions')
    .delete()
    .eq('id', params.vid)
    .eq('egg_id', params.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await logActivity({
    userId: admin.id,
    action: 'egg:version-delete',
    metadata: { egg_id: params.id, version_id: params.vid, name: existing.name },
  });
  return Response.json({ ok: true });
}
