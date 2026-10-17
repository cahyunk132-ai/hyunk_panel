import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { encryptSecret } from '@/lib/storage/crypto';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { getVpsForUser } from '@/lib/vps/access';
import { validateVpsPayload } from '@/lib/vps/validation';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_VPS_FIELDS = 'id, name, host, port, username, owner_id, created_at, is_backup_relay';

type RouteContext = { params: { id: string } };

function notFoundResponse() {
  return Response.json({ error: 'VPS tidak ditemukan atau Anda tidak memiliki akses' }, { status: 404 });
}

function canManageVps(userId: string, role: Parameters<typeof isPanelAdmin>[0], ownerId: string | null) {
  return isPanelAdmin(role) || ownerId === userId;
}

function bodyRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function resolveOwnerId(
  service: ReturnType<typeof getSupabaseServiceClient>,
  requested: unknown,
): Promise<{ ownerId: string | null; error?: never } | { ownerId?: never; error: Response }> {
  if (requested === null) return { ownerId: null };
  if (typeof requested !== 'string' || !requested.trim()) {
    return {
      error: Response.json({ error: 'owner_id harus berupa UUID user atau null' }, { status: 400 }),
    };
  }

  const ownerId = requested.trim();
  const { data: owner } = await service.from('users').select('id').eq('id', ownerId).maybeSingle();
  if (!owner) {
    return { error: Response.json({ error: 'User pemilik VPS tidak ditemukan' }, { status: 404 }) };
  }
  return { ownerId };
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
      is_backup_relay: vps.is_backup_relay,
    },
  });
}

/** Update an owned VPS, or any VPS for a panel administrator. */
export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  const vps = await getVpsForUser(params.id, user);
  if (!vps || !canManageVps(user.id, user.role, vps.owner_id)) return notFoundResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: 'Body request tidak valid' }, { status: 400 });
  }
  const body = bodyRecord(rawBody);
  if (!body) return Response.json({ error: 'Body request tidak valid' }, { status: 400 });

  const ownerProvided = Object.prototype.hasOwnProperty.call(body, 'owner_id');
  if (ownerProvided && !isPanelAdmin(user.role)) {
    return Response.json({ error: 'Hanya Owner Panel atau Admin yang dapat mengganti pemilik VPS' }, { status: 403 });
  }

  const fields = { ...body };
  delete fields.owner_id;
  const validated = validateVpsPayload(fields, { partial: true });
  const hasFieldChanges = Boolean(validated.data && Object.keys(validated.data).length > 0);
  if (validated.error && Object.keys(fields).length > 0) {
    return Response.json({ error: validated.error }, { status: 400 });
  }
  if (!hasFieldChanges && !ownerProvided) {
    return Response.json({ error: 'Tidak ada perubahan yang dikirim' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const update: Record<string, string | number | null> = {};
  const data = validated.data ?? {};
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

  let nextOwnerId = vps.owner_id;
  if (ownerProvided) {
    const resolved = await resolveOwnerId(service, body.owner_id);
    if (resolved.error) return resolved.error;
    nextOwnerId = resolved.ownerId;
    update.owner_id = nextOwnerId;
  }

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

  await logActivity({
    userId: user.id,
    action: ownerProvided && nextOwnerId !== vps.owner_id ? 'admin:vps-owner-update' : 'vps:update',
    metadata: {
      vps_id: vps.id,
      previous_owner_id: vps.owner_id,
      owner_id: nextOwnerId,
      fields: Object.keys(update).filter((field) => field !== 'credential'),
      credential_changed: data.credential !== undefined,
    },
  });

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

  await logActivity({
    userId: user.id,
    action: isPanelAdmin(user.role) && vps.owner_id !== user.id ? 'admin:vps-delete' : 'vps:delete',
    metadata: { vps_id: vps.id, owner_id: vps.owner_id },
  });

  return Response.json({ success: true });
}
