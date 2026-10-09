import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { encryptSecret } from '@/lib/storage/crypto';
import { toPublicProvider } from '@/lib/storage';

export const runtime = 'nodejs';

/**
 * POST /api/storage/providers/s3 — tambah S3-compatible storage secara manual.
 * Body: { name?, bucket, region?, access_key, secret_key, endpoint? }
 * Berlaku untuk: AWS S3, Cloudflare R2, Backblaze B2, MinIO.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    bucket?: string;
    region?: string;
    access_key?: string;
    secret_key?: string;
    endpoint?: string;
  };

  if (!body.bucket?.trim() || !body.access_key?.trim() || !body.secret_key?.trim()) {
    return Response.json(
      { error: 'bucket, access_key, dan secret_key wajib diisi' },
      { status: 400 },
    );
  }

  let encryptedSecret: string;
  try {
    encryptedSecret = encryptSecret(body.secret_key!.trim());
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal mengenkripsi secret' },
      { status: 500 },
    );
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('storage_providers')
    .insert({
      user_id: user.id,
      provider: 's3',
      name: body.name?.trim() || `S3 ${body.bucket!.trim()}`,
      config: {
        bucket: body.bucket!.trim(),
        region: body.region?.trim() || 'us-east-1',
        access_key: body.access_key!.trim(),
        secret_key: encryptedSecret, // terenkripsi AES-256-GCM
        endpoint: body.endpoint?.trim() || null,
      },
      is_active: true,
    })
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ provider: toPublicProvider(data) }, { status: 201 });
}
