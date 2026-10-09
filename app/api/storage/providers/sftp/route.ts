import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { encryptSecret } from '@/lib/storage/crypto';
import { toPublicProvider } from '@/lib/storage';

export const runtime = 'nodejs';

/**
 * POST /api/storage/providers/sftp — tambah SFTP storage secara manual.
 * Body: { name?, host, port?, username, password, path? }
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    path?: string;
  };

  if (!body.host?.trim() || !body.username?.trim() || !body.password) {
    return Response.json(
      { error: 'host, username, dan password wajib diisi' },
      { status: 400 },
    );
  }
  const port = Number(body.port ?? 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Response.json({ error: 'port tidak valid (1-65535)' }, { status: 400 });
  }

  let encryptedPassword: string;
  try {
    encryptedPassword = encryptSecret(body.password);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal mengenkripsi password' },
      { status: 500 },
    );
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('storage_providers')
    .insert({
      user_id: user.id,
      provider: 'sftp',
      name: body.name?.trim() || `SFTP ${body.host!.trim()}`,
      config: {
        host: body.host!.trim(),
        port,
        username: body.username!.trim(),
        password: encryptedPassword, // terenkripsi AES-256-GCM
        path: body.path?.trim() || '/',
      },
      is_active: true,
    })
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ provider: toPublicProvider(data) }, { status: 201 });
}
