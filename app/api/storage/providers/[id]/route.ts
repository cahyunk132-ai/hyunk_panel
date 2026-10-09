import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import type { StorageProviderRow } from '@/types';

export const runtime = 'nodejs';

/**
 * DELETE /api/storage/providers/[id] — putuskan (hapus) storage provider.
 * Provider yang masih dipakai jadwal backup tidak bisa dihapus (409).
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
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

  const { count, error: countErr } = await service
    .from('backup_schedules')
    .select('id', { count: 'exact', head: true })
    .eq('storage_provider_id', row.id);
  if (countErr) return Response.json({ error: countErr.message }, { status: 500 });
  if (count && count > 0) {
    return Response.json(
      {
        error: `Provider dipakai oleh ${count} jadwal backup — hapus jadwalnya terlebih dahulu sebelum disconnect`,
      },
      { status: 409 },
    );
  }

  const { error } = await service.from('storage_providers').delete().eq('id', row.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
