import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';
import { isJsonObject, parseVersionFields } from '@/lib/eggs/validation';

export const runtime = 'nodejs';

/** POST /api/admin/eggs/{id}/versions — add an Egg version. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = await request.json().catch(() => null);
  if (!isJsonObject(body)) return Response.json({ error: 'Body harus berupa object JSON.' }, { status: 400 });
  const parsed = parseVersionFields(body);
  if (parsed.error || !parsed.fields) {
    return Response.json({ error: parsed.error ?? 'Data versi tidak valid.' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data: egg, error: eggError } = await service.from('eggs').select('id').eq('id', params.id).maybeSingle();
  if (eggError) return Response.json({ error: eggError.message }, { status: 500 });
  if (!egg) return Response.json({ error: 'Egg tidak ditemukan.' }, { status: 404 });

  const { data: version, error } = await service
    .from('egg_versions')
    .insert({ ...parsed.fields, egg_id: params.id })
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (version.is_recommended) {
    await service
      .from('egg_versions')
      .update({ is_recommended: false })
      .eq('egg_id', params.id)
      .neq('id', version.id);
  }

  await logActivity({ userId: admin.id, action: 'egg:version-create', metadata: { egg_id: params.id, version_id: version.id } });
  return Response.json({ version }, { status: 201 });
}
