import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { encryptSecret } from '@/lib/storage/crypto';
import { listVpsForUser } from '@/lib/vps/access';
import { validateVpsPayload } from '@/lib/vps/validation';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_VPS_FIELDS = 'id, name, host, port, username, owner_id, created_at, is_backup_relay';

/** List the VPS visible to the current user without exposing credentials. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  return Response.json({ vps: await listVpsForUser(user) });
}

/**
 * Create a VPS. Regular users always become the owner of their own VPS;
 * Owner Panel/Admin may set owner_id to create one on behalf of another user.
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body request tidak valid' }, { status: 400 });
  }

  const validated = validateVpsPayload(body, { partial: false });
  if (validated.error || !validated.data) {
    return Response.json({ error: validated.error ?? 'Data VPS tidak valid' }, { status: 400 });
  }

  const rawOwnerId =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).owner_id
      : undefined;
  if (rawOwnerId !== undefined && !isPanelAdmin(user.role)) {
    return Response.json({ error: 'Hanya Owner Panel atau Admin yang dapat menentukan pemilik VPS' }, { status: 403 });
  }

  const service = getSupabaseServiceClient();
  let ownerId: string | null = user.id;
  if (rawOwnerId !== undefined) {
    if (rawOwnerId !== null && (typeof rawOwnerId !== 'string' || !rawOwnerId.trim())) {
      return Response.json({ error: 'owner_id harus berupa UUID user atau null' }, { status: 400 });
    }
    ownerId = typeof rawOwnerId === 'string' ? rawOwnerId.trim() : null;
    if (ownerId) {
      const { data: owner } = await service.from('users').select('id').eq('id', ownerId).maybeSingle();
      if (!owner) return Response.json({ error: 'User pemilik VPS tidak ditemukan' }, { status: 404 });
    }
  }

  const { data } = validated;
  let encryptedCredential: string;
  try {
    encryptedCredential = encryptSecret(data.credential as string);
  } catch (error) {
    console.error('Failed to encrypt VPS credential', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return Response.json({ error: 'Credential VPS tidak dapat diamankan' }, { status: 500 });
  }

  const { data: inserted, error } = await service
    .from('vps')
    .insert({
      name: data.name,
      host: data.host,
      port: data.port,
      username: data.username,
      credential: encryptedCredential,
      owner_id: ownerId || null,
    })
    .select(PUBLIC_VPS_FIELDS)
    .single();

  if (error || !inserted) {
    console.error('Failed to create VPS', { error: error?.message ?? 'unknown error' });
    return Response.json({ error: 'VPS gagal ditambahkan' }, { status: 500 });
  }

  await logActivity({
    userId: user.id,
    action: isPanelAdmin(user.role) && ownerId !== user.id ? 'admin:vps-create' : 'vps:create',
    metadata: { vps_id: inserted.id, owner_id: ownerId || null },
  });

  return Response.json({ vps: inserted }, { status: 201 });
}
