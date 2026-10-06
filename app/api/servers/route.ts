import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { WingsClient } from '@/lib/wings/client';
import { getNodeById, logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** GET /api/servers — daftar server yang bisa dilihat user (admin: semua). */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const service = getSupabaseServiceClient();

  if (user.role === 'admin') {
    const { data, error } = await service
      .from('servers')
      .select('*, nodes(name, fqdn), allocations(ip, port)')
      .order('created_at', { ascending: true });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ servers: data });
  }

  // User biasa: milik sendiri + yang terdaftar di server_users.
  const { data: assigned } = await service
    .from('server_users')
    .select('server_id')
    .eq('user_id', user.id);
  const ids = (assigned ?? []).map((r) => r.server_id as string);

  const { data, error } = await service
    .from('servers')
    .select('*, nodes(name, fqdn), allocations(ip, port)')
    .or(
      ids.length > 0
        ? `owner_id.eq.${user.id},id.in.(${ids.join(',')})`
        : `owner_id.eq.${user.id}`,
    )
    .order('created_at', { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ servers: data });
}

/**
 * POST /api/servers — daftarkan server baru (admin).
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
  if (user.role !== 'admin') return Response.json({ error: 'Butuh akses admin' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    node_id?: string;
    uuid?: string;
    ip?: string;
    port?: number;
    memory_mb?: number;
    cpu_limit?: number;
    disk_mb?: number | null;
    image?: string;
    startup?: string;
    env?: Record<string, string>;
    owner_id?: string | null;
    provision?: boolean;
  } | null;

  if (!body || !body.name || !body.node_id || !body.port || !body.memory_mb || !body.cpu_limit || !body.image || !body.startup) {
    return Response.json(
      { error: 'Field wajib: name, node_id, port, memory_mb, cpu_limit, image, startup' },
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
  const service = getSupabaseServiceClient();

  // Allocation
  const { data: alloc, error: allocErr } = await service
    .from('allocations')
    .upsert(
      { node_id: node.id, ip: body.ip ?? '0.0.0.0', port: body.port },
      { onConflict: 'node_id,ip,port' },
    )
    .select('id, assigned_to')
    .single();
  if (allocErr) return Response.json({ error: allocErr.message }, { status: 500 });
  if (alloc.assigned_to) {
    return Response.json({ error: `Port ${body.port} sudah dipakai server lain di panel` }, { status: 409 });
  }

  const { data: server, error: serverErr } = await service
    .from('servers')
    .insert({
      uuid: serverUuid,
      name: body.name,
      node_id: node.id,
      owner_id: body.owner_id ?? user.id,
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

  await service.from('allocations').update({ assigned_to: server.id }).eq('id', alloc.id);
  await service.from('server_users').upsert(
    {
      server_id: server.id,
      user_id: user.id,
      permissions: ['start', 'stop', 'restart', 'kill', 'console', 'files', 'backups', 'settings'],
    },
    { onConflict: 'server_id,user_id' },
  );

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
    metadata: { name: body.name, node: node.name, provisioned, provisionError },
  });

  return Response.json(
    { server: { id: server.id, uuid: server.uuid }, provisioned, provision_error: provisionError },
    { status: 201 },
  );
}
