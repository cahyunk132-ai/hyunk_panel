import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { getVpsForUser } from '@/lib/vps/access';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function notFoundResponse() {
  return Response.json({ error: 'VPS tidak ditemukan atau Anda tidak memiliki akses' }, { status: 404 });
}

/** Set or clear the authenticated owner's preferred VPS backup relay. */
export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  const vps = await getVpsForUser(params.id, user);
  if (!vps || (!isPanelAdmin(user.role) && vps.owner_id !== user.id)) return notFoundResponse();
  if (!vps.owner_id) {
    return Response.json({ error: 'VPS belum memiliki pemilik dan tidak dapat dijadikan relay' }, { status: 400 });
  }

  let enabled = true;
  let rawBody: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) rawBody = JSON.parse(text);
  } catch {
    return Response.json({ error: 'Body request tidak valid' }, { status: 400 });
  }
  const body = bodyRecord(rawBody);
  if (!body) return Response.json({ error: 'Body request tidak valid' }, { status: 400 });
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return Response.json({ error: 'Field enabled harus berupa boolean' }, { status: 400 });
  }
  if (typeof body.enabled === 'boolean') enabled = body.enabled;

  const service = getSupabaseServiceClient();
  if (enabled) {
    // Clear the previous relay first so setting another VPS automatically
    // leaves exactly one preferred relay for this owner.
    const { error: clearError } = await service
      .from('vps')
      .update({ is_backup_relay: false })
      .eq('owner_id', vps.owner_id);
    if (clearError) {
      console.error('Failed to clear existing VPS backup relay', {
        ownerId: vps.owner_id,
        error: clearError.message,
      });
      return Response.json({ error: 'Backup relay gagal diperbarui' }, { status: 500 });
    }
  }

  const { data: updated, error: updateError } = await service
    .from('vps')
    .update({ is_backup_relay: enabled })
    .eq('id', vps.id)
    .eq('owner_id', vps.owner_id)
    .select('id, is_backup_relay')
    .maybeSingle();

  if (updateError || !updated) {
    console.error('Failed to update VPS backup relay', {
      vpsId: vps.id,
      ownerId: vps.owner_id,
      error: updateError?.message ?? 'VPS tidak ditemukan',
    });
    return Response.json({ error: 'Backup relay gagal diperbarui' }, { status: 500 });
  }

  await logActivity({
    userId: user.id,
    action: enabled ? 'vps:backup-relay-enable' : 'vps:backup-relay-disable',
    metadata: { vps_id: vps.id, owner_id: vps.owner_id },
  });

  return Response.json({
    vps: {
      id: updated.id,
      is_backup_relay: Boolean(updated.is_backup_relay),
    },
  });
}
