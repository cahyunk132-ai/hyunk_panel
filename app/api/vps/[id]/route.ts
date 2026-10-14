import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { encryptSecret } from '@/lib/storage/crypto';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { getVpsForUser } from '@/lib/vps/access';
import { validateVpsPayload } from '@/lib/vps/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_VPS_FIELDS = 'id, name, host, port, username, owner_id, created_at';

type RouteContext = { params: { id: string } };

function notFoundResponse() {
  return Response.json({ error: 'VPS tidak ditemukan atau Anda tidak memiliki akses' }, { status: 404 });
}

function canManageVps(userId: string, role: Parameters<typeof isPanelAdmin>[0], ownerId: string | null) {
  return isPanelAdmin(role) || ownerId === userId;
}

/** Return metadata only. The encrypted credential is never serialized. */
export async function GET(_request: Request, { params }: RouteContext) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  const vps = await getVpsForUser(params.id, user);
  if (!vps) return notFoundResponse();

  return Response.json({
    vps: {
      id: vps.id,
      name: vps.name,
      host: vps.host,
      port: vps.port,
      username: vps.username,
      owner_id: vps.owner_id,
      created_at: vps.created_at,
    },
  });
}

/** Update an owned VPS, or any VPS for a panel administrator. */
export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  const vps = await getVpsForUser(params.id, user);
  if (!vps || !canManageVps(user.id, user.role, vps.owner_id)) return notFoundResponse();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body request tidak valid' }, { status: 400 });
  }

  const validated = validateVpsPayload(body, { partial: true });
  if (validated.error || !validated.data) {
    return Response.json({ error: validated.error ?? 'Data VPS tidak valid' }, { status: 400 });
  }

  const update: Record<string, string | number> = {};
  const { data } = validated;
  if (data.name !== undefined) update.name = data.name;
  if (data.host !== undefined) update.host = data.host;
  if (data.port !== undefined) update.port = data.port;
  if (data.username !== undefined) update.username = data.username;

  if (data.credential !== undefined) {
    try {
      update.credential = encryptSecret(data.credential);
    } catch (error) {
      console.error('Failed to encrypt VPS credential', {
        vpsId: vps.id,
        error: error instanceof Error ? error.message : 'unknown error',
      });
      return Response.json({ error: 'Credential VPS tidak dapat diamankan' }, { status: 500 });
    }
  }

  const service = getSupabaseServiceClient();
  const { data: updated, error } = await service
    .from('vps')
    .update(update)
    .eq('id', vps.id)
    .select(PUBLIC_VPS_FIELDS)
    .single();

  if (error || !updated) {
    console.error('Failed to update VPS', { vpsId: vps.id, error: error?.message ?? 'unknown error' });
    return Response.json({ error: 'VPS gagal diperbarui' }, { status: 500 });
  }

  return Response.json({ vps: updated });
}

/** Delete an owned VPS, or any VPS for a panel administrator. */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  const vps = await getVpsForUser(params.id, user);
  if (!vps || !canManageVps(user.id, user.role, vps.owner_id)) return notFoundResponse();

  const service = getSupabaseServiceClient();
  const { error } = await service.from('vps').delete().eq('id', vps.id);
  if (error) {
    console.error('Failed to delete VPS', { vpsId: vps.id, error: error.message });
    return Response.json({ error: 'VPS gagal dihapus' }, { status: 500 });
  }

  return Response.json({ success: true });
}
