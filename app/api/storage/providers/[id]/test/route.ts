import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { testProvider } from '@/lib/storage';
import type { StorageProviderRow } from '@/types';

export const runtime = 'nodejs';

/**
 * GET /api/storage/providers/[id]/test — test koneksi provider.
 * Token OAuth yang expired akan di-refresh otomatis (dan disimpan kembali).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const service = getSupabaseServiceClient();
  const { data: provider } = await service
    .from('storage_providers')
    .select('*')
    .eq('id', params.id)
    .maybeSingle();
  if (!provider) return Response.json({ error: 'Provider tidak ditemukan' }, { status: 404 });

  const row = provider as StorageProviderRow;
  if (row.user_id !== user.id && !isPanelAdmin(user.role)) {
    return Response.json({ error: 'Provider ini bukan milik Anda' }, { status: 403 });
  }

  const result = await testProvider(row);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
