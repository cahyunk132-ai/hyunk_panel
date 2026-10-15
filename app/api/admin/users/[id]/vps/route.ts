import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/**
 * POST /api/admin/users/{id}/vps — give a user read-only access to a VPS.
 * Ownership stays on vps.owner_id; vps_users is an additional assignment.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as { vps_id?: unknown } | null;
  if (typeof body?.vps_id !== 'string' || !body.vps_id.trim()) {
    return Response.json({ error: 'Field wajib: vps_id' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const [{ data: target }, { data: vps }] = await Promise.all([
    service.from('users').select('id, role').eq('id', params.id).maybeSingle(),
    service.from('vps').select('id, name, owner_id').eq('id', body.vps_id.trim()).maybeSingle(),
  ]);

  if (!target) return Response.json({ error: 'User tidak ditemukan' }, { status: 404 });
  if (target.role !== 'user' && target.role !== 'subuser') {
    return Response.json({ error: 'VPS hanya dapat di-assign ke User atau Subuser' }, { status: 400 });
  }
  if (!vps) return Response.json({ error: 'VPS tidak ditemukan' }, { status: 404 });
  if (vps.owner_id === target.id) {
    return Response.json({ error: 'User tersebut sudah menjadi pemilik VPS ini' }, { status: 409 });
  }

  const { error } = await service.from('vps_users').upsert(
    {
      vps_id: vps.id,
      user_id: target.id,
      permissions: [],
    },
    { onConflict: 'vps_id,user_id' },
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: admin.id,
    action: 'admin:vps-assign',
    metadata: { vps_id: vps.id, vps_name: vps.name, assigned_to: target.id, access: 'read-only' },
  });
  return Response.json({ ok: true }, { status: 201 });
}

/** DELETE /api/admin/users/{id}/vps — remove an additional VPS assignment. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as { vps_id?: unknown } | null;
  if (typeof body?.vps_id !== 'string' || !body.vps_id.trim()) {
    return Response.json({ error: 'Field wajib: vps_id' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from('vps_users')
    .delete()
    .eq('vps_id', body.vps_id.trim())
    .eq('user_id', params.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: admin.id,
    action: 'admin:vps-unassign',
    metadata: { vps_id: body.vps_id.trim(), removed_from: params.id },
  });
  return Response.json({ ok: true });
}
