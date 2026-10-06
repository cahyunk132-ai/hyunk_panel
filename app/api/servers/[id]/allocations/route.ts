import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';
import type { AllocationRow, ServerRow } from '@/types';

export const runtime = 'nodejs';

async function syncWings(server: ServerRow | null): Promise<string | null> {
  if (!server) return 'Server tidak ditemukan saat sinkronisasi.';
  const resolved = await resolveServerWings(server);
  if (resolved instanceof Response) return 'Alokasi tersimpan, tetapi node belum dapat disinkronkan.';
  try {
    await resolved.client.syncServer(server.uuid);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Sinkronisasi Wings gagal.';
  }
}

async function getServerForSync(id: string): Promise<ServerRow | null> {
  const service = getSupabaseServiceClient();
  const { data } = await service.from('servers').select('*').eq('id', id).maybeSingle();
  return (data as ServerRow | null) ?? null;
}

/** GET /api/servers/{id}/allocations — port terpasang dan port bebas pada node yang sama. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const result = await checkPermission(user, 'settings', params.id);
  if (result instanceof Response) return result;

  const service = getSupabaseServiceClient();
  const [{ data: assigned, error: assignedError }, { data: available, error: availableError }] =
    await Promise.all([
      service
        .from('allocations')
        .select('id, node_id, ip, port, assigned_to, created_at')
        .eq('node_id', result.server.node_id)
        .eq('assigned_to', result.server.id)
        .order('port', { ascending: true }),
      service
        .from('allocations')
        .select('id, node_id, ip, port, assigned_to, created_at')
        .eq('node_id', result.server.node_id)
        .is('assigned_to', null)
        .order('port', { ascending: true }),
    ]);
  if (assignedError || availableError) {
    return Response.json({ error: assignedError?.message ?? availableError?.message }, { status: 500 });
  }

  return Response.json({
    allocations: (assigned ?? []).map((allocation) => ({
      ...(allocation as AllocationRow),
      is_primary: allocation.id === result.server.allocation_id,
    })),
    available: available ?? [],
  });
}

/** POST /api/servers/{id}/allocations — assign port bebas dari node server. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const result = await checkPermission(user, 'settings', params.id);
  if (result instanceof Response) return result;

  const body = (await request.json().catch(() => null)) as { allocation_id?: string } | null;
  if (!body || typeof body.allocation_id !== 'string' || !body.allocation_id) {
    return Response.json({ error: 'allocation_id wajib diisi' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data: allocation, error } = await service
    .from('allocations')
    .update({ assigned_to: result.server.id })
    .eq('id', body.allocation_id)
    .eq('node_id', result.server.node_id)
    .is('assigned_to', null)
    .select('id, node_id, ip, port, assigned_to, created_at')
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!allocation) {
    return Response.json({ error: 'Port sudah dipakai atau bukan milik node server ini.' }, { status: 409 });
  }

  await logActivity({
    userId: user.id,
    serverId: result.server.id,
    action: 'server:allocation-add',
    metadata: { ip: allocation.ip, port: allocation.port },
  });

  const syncError = await syncWings(await getServerForSync(result.server.id));
  return Response.json(
    {
      allocation: { ...allocation, is_primary: allocation.id === result.server.allocation_id },
      wings_synced: !syncError,
      wings_sync_error: syncError,
    },
    { status: 201 },
  );
}

/** DELETE /api/servers/{id}/allocations — free an additional port without deleting it. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const result = await checkPermission(user, 'settings', params.id);
  if (result instanceof Response) return result;

  const body = (await request.json().catch(() => null)) as { allocation_id?: string } | null;
  if (!body || typeof body.allocation_id !== 'string' || !body.allocation_id) {
    return Response.json({ error: 'allocation_id wajib diisi' }, { status: 400 });
  }
  if (body.allocation_id === result.server.allocation_id) {
    return Response.json({ error: 'Port utama tidak dapat dihapus.' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data: allocation, error } = await service
    .from('allocations')
    .update({ assigned_to: null })
    .eq('id', body.allocation_id)
    .eq('node_id', result.server.node_id)
    .eq('assigned_to', result.server.id)
    .select('id, node_id, ip, port, assigned_to, created_at')
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!allocation) return Response.json({ error: 'Port tambahan tidak ditemukan.' }, { status: 404 });

  await logActivity({
    userId: user.id,
    serverId: result.server.id,
    action: 'server:allocation-remove',
    metadata: { ip: allocation.ip, port: allocation.port },
  });

  const syncError = await syncWings(await getServerForSync(result.server.id));
  return Response.json({
    ok: true,
    wings_synced: !syncError,
    wings_sync_error: syncError,
  });
}
