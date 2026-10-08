import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission, getServerByIdOrUuid, hasPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';
import type { ServerRow } from '@/types';

export const runtime = 'nodejs';

/** GET /api/servers/{id} — detail server + node publik + allocation. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  // Setiap assignment boleh membuka ringkasan server; fitur di dalamnya tetap
  // memeriksa permission operasional masing-masing.
  const result = await checkPermission(user, 'server.read', params.id);
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

/** PATCH /api/servers/{id} — update konfigurasi panel lalu minta Wings sync dari Remote API. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const result = await checkPermission(user, 'settings', params.id);
  if (result instanceof Response) return result;
  const server = result.server;

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
      if (key === 'is_suspended' && !(await hasPermission(user, 'suspend_server', server.id))) {
        return Response.json({ error: 'Hanya Owner Panel atau Admin yang bisa suspend/unsuspend' }, { status: 403 });
      }
      update[key] = body[key];
    }
  }
  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'Tidak ada field yang diubah' }, { status: 400 });
  }
  if (update.name !== undefined && (typeof update.name !== 'string' || !update.name.trim())) {
    return Response.json({ error: 'Nama server wajib diisi' }, { status: 400 });
  }
  if (
    update.memory_mb !== undefined &&
    (typeof update.memory_mb !== 'number' || !Number.isFinite(update.memory_mb) || update.memory_mb < 128)
  ) {
    return Response.json({ error: 'memory_mb minimal 128 MB' }, { status: 400 });
  }
  if (
    update.cpu_limit !== undefined &&
    (typeof update.cpu_limit !== 'number' || !Number.isFinite(update.cpu_limit) || update.cpu_limit < 1)
  ) {
    return Response.json({ error: 'cpu_limit harus berupa angka positif' }, { status: 400 });
  }
  if (
    update.disk_mb !== undefined &&
    (typeof update.disk_mb !== 'number' || !Number.isFinite(update.disk_mb) || update.disk_mb < 1024)
  ) {
    return Response.json({ error: 'disk_mb minimal 1024 MB' }, { status: 400 });
  }
  if (update.image !== undefined && (typeof update.image !== 'string' || !update.image.trim())) {
    return Response.json({ error: 'Docker image wajib diisi' }, { status: 400 });
  }
  if (update.startup !== undefined && (typeof update.startup !== 'string' || !update.startup.trim())) {
    return Response.json({ error: 'startup command wajib diisi' }, { status: 400 });
  }
  if (update.env !== undefined) {
    if (!update.env || typeof update.env !== 'object' || Array.isArray(update.env)) {
      return Response.json({ error: 'env harus berupa object key-value' }, { status: 400 });
    }
    const entries = Object.entries(update.env as Record<string, unknown>);
    if (entries.some(([key, value]) => !key.trim() || typeof value !== 'string')) {
      return Response.json({ error: 'Semua environment variable harus memiliki key dan value teks' }, { status: 400 });
    }
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('servers')
    .update(update)
    .eq('id', server.id)
    .select('*')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Wings v1.5+ menarik konfigurasi terbaru dari Remote API melalui /sync.
  // Perubahan panel tetap tersimpan jika node sedang offline; klien mendapat status sync.
  let wingsSyncError: string | null = null;
  const resolved = await resolveServerWings(data as ServerRow);
  if (resolved instanceof Response) {
    wingsSyncError = 'Konfigurasi tersimpan, tetapi koneksi ke node belum tersedia.';
  } else {
    try {
      await resolved.client.syncServer(server.uuid);
    } catch (err) {
      wingsSyncError = err instanceof Error ? err.message : 'Sinkronisasi Wings gagal.';
    }
  }

  await logActivity({
    userId: user.id,
    serverId: server.id,
    action: 'server:update',
    metadata: { fields: Object.keys(update), wings_synced: !wingsSyncError },
  });
  return Response.json({
    server: data,
    wings_synced: !wingsSyncError,
    wings_sync_error: wingsSyncError,
  });
}

/**
 * DELETE /api/servers/{id}
 * Selalu memerlukan konfirmasi nama server. `destroy: true` juga menghapus container
 * + seluruh data di node melalui Wings; tanpa itu, data node tetap utuh.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!(await hasPermission(user, 'delete_server'))) {
    return Response.json({ error: 'Hanya Owner Panel atau Admin yang dapat menghapus server' }, { status: 403 });
  }

  const server = await getServerByIdOrUuid(params.id);
  if (!server) return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { destroy?: boolean; confirm?: string };
  const destroy = body.destroy === true || request.nextUrl.searchParams.get('destroy') === 'true';
  const confirm = body.confirm ?? request.nextUrl.searchParams.get('confirm');
  if (confirm !== server.name) {
    return Response.json(
      { error: 'Konfirmasi diperlukan. Ketik nama server dengan tepat sebelum menghapus.' },
      { status: 400 },
    );
  }

  if (destroy) {
    const resolved = await resolveServerWings(server);
    if (resolved instanceof Response) {
      return Response.json({ error: 'Tidak dapat menghubungi Wings; server tidak dihapus.' }, { status: 502 });
    }
    try {
      await resolved.client.destroyServer(server.uuid);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal menghapus server di Wings';
      await logActivity({
        userId: user.id,
        serverId: server.id,
        action: 'server:destroy-failed',
        metadata: { name: server.name, wings_error: message },
      });
      return Response.json(
        { error: `Data di node gagal dihapus; record panel dipertahankan agar dapat dicoba ulang. ${message}` },
        { status: 502 },
      );
    }
  }

  const service = getSupabaseServiceClient();
  const { error: usersError } = await service.from('server_users').delete().eq('server_id', server.id);
  if (usersError) return Response.json({ error: `Gagal menghapus akses server: ${usersError.message}` }, { status: 500 });

  const { error: backupsError } = await service.from('backups').delete().eq('server_id', server.id);
  if (backupsError) return Response.json({ error: `Gagal menghapus backup server: ${backupsError.message}` }, { status: 500 });

  const { error: activityError } = await service.from('activity_logs').delete().eq('server_id', server.id);
  if (activityError) return Response.json({ error: `Gagal menghapus activity log server: ${activityError.message}` }, { status: 500 });

  // Allocation tetap disimpan untuk digunakan kembali oleh server lain.
  const { error: allocationError } = await service
    .from('allocations')
    .update({ assigned_to: null })
    .eq('assigned_to', server.id);
  if (allocationError) {
    return Response.json({ error: `Gagal melepas allocation server: ${allocationError.message}` }, { status: 500 });
  }

  const { error: serverError } = await service.from('servers').delete().eq('id', server.id);
  if (serverError) return Response.json({ error: serverError.message }, { status: 500 });

  // Audit event ini sengaja tidak dikaitkan ke server yang sudah dihapus.
  await logActivity({
    userId: user.id,
    action: destroy ? 'server:destroy' : 'server:unlink-panel',
    metadata: { name: server.name, uuid: server.uuid, destroyed_on_node: destroy },
  });

  return Response.json({ ok: true, destroyed_on_node: destroy });
}
