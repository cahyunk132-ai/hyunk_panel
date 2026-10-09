import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { encryptSecret } from '@/lib/storage/crypto';
import { toPublicProvider } from '@/lib/storage';

export const runtime = 'nodejs';

/**
 * POST /api/storage/providers/webdav — tambah WebDAV storage secara manual.
 * Body: { name?, url, username, password }
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    url?: string;
    username?: string;
    password?: string;
  };

  if (!body.url?.trim() || !body.username?.trim() || !body.password) {
    return Response.json(
      { error: 'url, username, dan password wajib diisi' },
      { status: 400 },
    );
  }
  if (!/^https?:\/\//i.test(body.url.trim())) {
    return Response.json({ error: 'url harus diawali http:// atau https://' }, { status: 400 });
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
      provider: 'webdav',
      name: body.name?.trim() || `WebDAV ${body.url!.trim()}`,
      config: {
        url: body.url!.trim(),
        username: body.username!.trim(),
        password: encryptedPassword, // terenkripsi AES-256-GCM
      },
      is_active: true,
    })
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ provider: toPublicProvider(data) }, { status: 201 });
}
