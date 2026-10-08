import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission, hasPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { WingsClient } from '@/lib/wings/client';
import { getNodeById, logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** GET /api/servers — daftar server yang bisa dilihat user (admin: semua). */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const service = getSupabaseServiceClient();

  const query = service
    .from('servers')
    .select('*, nodes(name, fqdn), allocations(ip, port)')
    .order('created_at', { ascending: true });

  if (await hasPermission(user, 'view_all_servers')) {
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ servers: data });
  }

  // User/Subuser hanya melihat assignment eksplisit di server_users.
  const { data: assigned } = await service
    .from('server_users')
    .select('server_id')
    .eq('user_id', user.id);
  const ids = (assigned ?? []).map((r) => r.server_id as string);
  const scopedQuery = ids.length > 0 ? query.in('id', ids) : query.limit(0);
  const { data, error } = await scopedQuery;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ servers: data });
}

/**
 * POST /api/servers — daftarkan server baru (Owner Panel/Admin).
 *
 * Body: { name, node_id, uuid?, port, memory_mb, cpu_limit, disk_mb?, image,
 *         startup, env?, owner_id?, provision? }
 *
 * `provision: true` → panel memanggil POST /api/servers di Wings, yang akan
 * menarik konfigurasi penuh dari Remote API panel (Phase 1b) dan menjalankan
 * install. Jika node belum menunjuk ke panel ini (remote URL), gunakan false.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!(await hasPermission(user, 'create_server'))) {
    return Response.json({ error: 'Aksi ini hanya dapat dilakukan Owner Panel atau Admin' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    node_id?: string;
    uuid?: string;
    ip?: string;
    port?: number;
    allocation_id?: string;
    memory_mb?: number;
    cpu_limit?: number;
    disk_mb?: number | null;
    image?: string;
    startup?: string;
    env?: Record<string, string>;
    owner_id?: string | null;
    provision?: boolean;
  } | null;

  if (
    !body ||
    !body.name ||
    !body.node_id ||
    (!body.allocation_id && !body.port) ||
    !body.memory_mb ||
    !body.cpu_limit ||
    !body.image ||
    !body.startup
  ) {
    return Response.json(
      { error: 'Field wajib: name, node_id, allocation_id, memory_mb, cpu_limit, image, startup' },
      { status: 400 },
    );
  }

  const node = await getNodeById(body.node_id);
  if (!node) return Response.json({ error: 'Node tidak ditemukan' }, { status: 404 });

  // Disk limit: default 10240 MB (10 GB) bila tidak diisi, minimal 1024 MB.
  const diskMb = body.disk_mb ?? 10240;
  if (!Number.isFinite(diskMb) || diskMb < 1024) {
    return Response.json({ error: 'disk_mb minimal 1024 MB' }, { status: 400 });
  }

  const serverUuid = body.uuid ?? crypto.randomUUID();
  const serverOwnerId = body.owner_id || user.id;
  const service = getSupabaseServiceClient();
  if (body.owner_id) {
    const { data: selectedOwner } = await service
      .from('users')
      .select('id, role')
      .eq('id', body.owner_id)
      .maybeSingle();
    if (!selectedOwner || selectedOwner.role !== 'user') {
      return Response.json({ error: 'Server hanya dapat di-assign ke akun dengan role User' }, { status: 400 });
    }
  }

  // ── Allocation: port diambil dari tabel `allocations` milik node ini ──────
  // Jalur utama: `allocation_id` hasil dropdown (port sudah terdaftar di node).
  // Jalur kompatibilitas: `port` mentah → allocation dibuat otomatis bila belum ada.
  let alloc: { id: string; ip: string; port: number; assigned_to: string | null } | null = null;

  if (body.allocation_id) {
    const { data, error } = await service
      .from('allocations')
      .select('id, node_id, ip, port, assigned_to')
      .eq('id', body.allocation_id)
      .maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data) return Response.json({ error: 'Allocation tidak ditemukan' }, { status: 404 });
    if (data.node_id !== node.id) {
      return Response.json({ error: 'Allocation bukan milik node yang dipilih' }, { status: 400 });
    }
    if (data.assigned_to) {
      return Response.json(
        { error: `Port ${data.ip}:${data.port} sudah dipakai server lain di node ini` },
        { status: 409 },
      );
    }
    alloc = data;
  } else {
    const { data, error } = await service
      .from('allocations')
      .upsert(
        { node_id: node.id, ip: body.ip ?? '0.0.0.0', port: body.port },
        { onConflict: 'node_id,ip,port' },
      )
      .select('id, ip, port, assigned_to')
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (data.assigned_to) {
      return Response.json({ error: `Port ${body.port} sudah dipakai server lain di panel` }, { status: 409 });
    }
    alloc = data;
  }

  const { data: server, error: serverErr } = await service
    .from('servers')
    .insert({
      uuid: serverUuid,
      name: body.name,
      node_id: node.id,
      owner_id: serverOwnerId,
      allocation_id: alloc.id,
      memory_mb: body.memory_mb,
      cpu_limit: body.cpu_limit,
      disk_mb: diskMb,
      image: body.image,
      startup: body.startup,
      env: body.env ?? {},
      status: body.provision ? 'installing' : 'offline',
    })
    .select('id, uuid')
    .single();
  if (serverErr) {
    if (serverErr.code === '23505') {
      return Response.json({ error: 'UUID server sudah terdaftar di panel' }, { status: 409 });
    }
    return Response.json({ error: serverErr.message }, { status: 500 });
  }

  // Klaim port secara atomic: kalau balapan dengan request lain, server dibatalkan.
  const { data: claimed, error: claimError } = await service
    .from('allocations')
    .update({ assigned_to: server.id })
    .eq('id', alloc.id)
    .is('assigned_to', null)
    .select('id')
    .maybeSingle();
  if (claimError || !claimed) {
    await service.from('servers').delete().eq('id', server.id);
    return Response.json(
      {
        error: `Port ${alloc.ip}:${alloc.port} baru saja dipakai server lain. Pilih port lain dari daftar allocation.`,
      },
      { status: 409 },
    );
  }
  const { data: serverOwner } = await service
    .from('users')
    .select('role')
    .eq('id', serverOwnerId)
    .maybeSingle();
  if (serverOwner?.role === 'user') {
    await service.from('server_users').upsert(
      {
        server_id: server.id,
        user_id: serverOwnerId,
        role: 'user',
        permissions: [
          'start',
          'stop',
          'restart',
          'console',
          'console.send',
          'monitoring',
          'files.read',
          'files.edit',
          'backups',
          'backup.restore',
          'backups.delete',
          'players',
        ],
      },
      { onConflict: 'server_id,user_id' },
    );
  }

  let provisioned = false;
  let provisionError: string | null = null;
  if (body.provision) {
    try {
      const client = new WingsClient(node);
      await client.provisionServer(serverUuid, false);
      provisioned = true;
    } catch (err) {
      provisionError = err instanceof Error ? err.message : 'unknown';
      await service.from('servers').update({ status: 'error' }).eq('id', server.id);
    }
  }

  await logActivity({
    userId: user.id,
    serverId: server.id,
    action: 'server:create',
    metadata: {
      name: body.name,
      node: node.name,
      allocation: `${alloc.ip}:${alloc.port}`,
      provisioned,
      provisionError,
    },
  });

  return Response.json(
    {
      server: { id: server.id, uuid: server.uuid },
      allocation: { id: alloc.id, ip: alloc.ip, port: alloc.port },
      provisioned,
      provision_error: provisionError,
    },
    { status: 201 },
  );
}
