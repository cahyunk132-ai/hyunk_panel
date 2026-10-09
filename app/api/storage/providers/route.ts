import { requireUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { toPublicProvider } from '@/lib/storage';
import type { StorageProviderRow } from '@/types';

export const runtime = 'nodejs';

/**
 * GET /api/storage/providers — daftar storage provider milik user saat ini.
 * Kredensial (token, secret, password) tidak pernah ikut dikembalikan.
 */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('storage_providers')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const providers = (data ?? []) as StorageProviderRow[];

  // Hitung berapa jadwal backup yang memakai tiap provider ("Used by N servers").
  const ids = providers.map((p) => p.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: schedules } = await service
      .from('backup_schedules')
      .select('storage_provider_id')
      .in('storage_provider_id', ids);
    for (const row of schedules ?? []) {
      const pid = row.storage_provider_id as string;
      counts[pid] = (counts[pid] ?? 0) + 1;
    }
  }

  return Response.json({
    providers: providers.map((p) => toPublicProvider(p, counts[p.id] ?? 0)),
  });
}
