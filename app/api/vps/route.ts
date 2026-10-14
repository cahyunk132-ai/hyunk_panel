import { getSessionUser } from '@/lib/auth/session';
import { encryptSecret } from '@/lib/storage/crypto';
import { listVpsForUser } from '@/lib/vps/access';
import { validateVpsPayload } from '@/lib/vps/validation';
import { getSupabaseServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_VPS_FIELDS = 'id, name, host, port, username, owner_id, created_at';

/** List the VPS visible to the current user without exposing credentials. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  return Response.json({ vps: await listVpsForUser(user) });
}

/** Create a VPS owned by the authenticated user. */
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

  const service = getSupabaseServiceClient();
  const { data: inserted, error } = await service
    .from('vps')
    .insert({
      name: data.name,
      host: data.host,
      port: data.port,
      username: data.username,
      credential: encryptedCredential,
      // Never accept owner_id from the browser.
      owner_id: user.id,
    })
    .select(PUBLIC_VPS_FIELDS)
    .single();

  if (error || !inserted) {
    console.error('Failed to create VPS', { error: error?.message ?? 'unknown error' });
    return Response.json({ error: 'VPS gagal ditambahkan' }, { status: 500 });
  }

  return Response.json({ vps: inserted }, { status: 201 });
}
