import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission, getServerByIdOrUuid } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** GET /api/servers/{id} — detail server + node publik + allocation. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  // Akses baca: permission 'console' sebagai baseline "boleh membuka halaman server".
  const result = await checkPermission(user, 'console', params.id);
  if (result instanceof Response) return result;

  const server = await getServerByIdOrUuid(params.id);
  if (!server) return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });

  const service = getSupabaseServiceClient();
  const [{ data: node }, { data: allocation }, { data: owner }] = await Promise.all([
    service
      .from('nodes')
      .select('id, name, fqdn, port, uuid, location, is_maintenance')
      .eq('id', server.node_id)
      .maybeSingle(),
    server.allocation_id
      ? service.from('allocations').select('ip, port').eq('id', server.allocation_id).maybeSingle()
      : Promise.resolve({ data: null } as const),
    server.owner_id
      ? service.from('users').select('id, username').eq('id', server.owner_id).maybeSingle()
      : Promise.resolve({ data: null } as const),
  ]);

  return Response.json({ server: { ...server, node, allocation, owner } });
}

/** PATCH /api/servers/{id} — update konfigurasi server (admin atau pemilik akses settings). */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const result = await checkPermission(user, 'settings', params.id);
  if (result instanceof Response && user.role !== 'admin') return result;
  const server = result instanceof Response ? await getServerByIdOrUuid(params.id) : result.server;
  if (!server) return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const update: Record<string, unknown> = {};
  const editable = [
    'name',
    'memory_mb',
    'cpu_limit',
    'disk_mb',
    'image',
    'startup',
    'env',
    'is_suspended',
  ] as const;
  for (const key of editable) {
    if (body[key] !== undefined) {
      // is_suspended hanya oleh admin.
      if (key === 'is_suspended' && user.role !== 'admin') {
        return Response.json({ error: 'Hanya admin yang bisa suspend/unsuspend' }, { status: 403 });
      }
      update[key] = body[key];
    }
  }
  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'Tidak ada field yang diubah' }, { status: 400 });
  }
  if (
    update.disk_mb !== undefined &&
    (typeof update.disk_mb !== 'number' || !Number.isFinite(update.disk_mb) || update.disk_mb < 1024)
  ) {
    return Response.json({ error: 'disk_mb minimal 1024 MB' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('servers')
    .update(update)
    .eq('id', server.id)
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: user.id,
    serverId: server.id,
    action: 'server:update',
    metadata: { fields: Object.keys(update) },
  });
  return Response.json({ server: data });
}

/**
 * DELETE /api/servers/{id}
 * Mode aman (default)  : hapus dari PANEL SAJA. Container + data di node TIDAK disentuh.
 * Mode berbahaya       : ?destroy=true&confirm=<name> juga memanggil DELETE di Wings
 *                        yang MENGHAPUS container BESERTA volume data. Butuh nama server
 *                        sebagai konfirmasi ganda.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (user.role !== 'admin') return Response.json({ error: 'Butuh akses admin' }, { status: 403 });

  const server = await getServerByIdOrUuid(params.id);
  if (!server) return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });

  const destroy = request.nextUrl.searchParams.get('destroy') === 'true';
  const confirm = request.nextUrl.searchParams.get('confirm');

  if (destroy) {
    if (confirm !== server.name) {
      return Response.json(
        {
          error:
            'Konfirmasi ganda diperlukan. Kirim ?destroy=true&confirm=<nama server persis> untuk menghapus container dan data di node.',
        },
        { status: 400 },
      );
    }
    const resolved = await resolveServerWings(server);
    if (!(resolved instanceof Response)) {
      try {
        await resolved.client.destroyServer(server.uuid);
      } catch (err) {
        // Lanjutkan penghapusan di panel meski wings gagal (node mungkin mati),
        // tapi laporkan ke caller.
        await logActivity({
          userId: user.id,
          serverId: server.id,
          action: 'server:destroy-partial',
          metadata: { name: server.name, wings_error: err instanceof Error ? err.message : 'unknown' },
        });
      }
    }
  }

  const service = getSupabaseServiceClient();
  const { error } = await service.from('servers').delete().eq('id', server.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: user.id,
    action: destroy ? 'server:destroy' : 'server:unlink-panel',
    metadata: { name: server.name, destroyed_on_node: destroy },
  });

  return Response.json({ ok: true, destroyed_on_node: destroy });
}
