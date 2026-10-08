import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { getNodeById, logActivity } from '@/lib/wings/resolve';
import { formatAllocation, formatPortRanges, isValidAllocationIp, parsePortSpec } from '@/lib/utils/allocations';
import type { AllocationRow, NodeAllocation, NodeRow } from '@/types';

export const runtime = 'nodejs';

const ALLOCATION_SELECT = 'id, node_id, ip, port, assigned_to, created_at';
/** Insert batch dibagi agar payload tidak terlalu besar untuk satu request PostgREST. */
const INSERT_CHUNK = 500;

/**
 * Ambil nama server untuk allocation yang sedang dipakai.
 * Dilakukan sebagai query terpisah (bukan embed PostgREST) supaya tidak
 * bergantung pada penamaan constraint FK.
 */
async function attachServers(rows: AllocationRow[]): Promise<NodeAllocation[]> {
  const assignedIds = Array.from(
    new Set(rows.map((row) => row.assigned_to).filter((id): id is string => Boolean(id))),
  );
  const names = new Map<string, string>();
  if (assignedIds.length > 0) {
    const service = getSupabaseServiceClient();
    const { data } = await service.from('servers').select('id, name').in('id', assignedIds);
    for (const server of data ?? []) names.set(server.id as string, server.name as string);
  }
  return rows.map((row) => ({
    ...row,
    server: row.assigned_to ? { id: row.assigned_to, name: names.get(row.assigned_to) ?? 'Server tidak dikenal' } : null,
  }));
}

async function resolveNode(idOrUuid: string): Promise<NodeRow | null> {
  return getNodeById(idOrUuid);
}

/**
 * GET /api/nodes/{id}/allocations
 * Query: ?status=available → hanya port yang belum dipakai server.
 * Hanya Owner Panel/Admin boleh membaca allocation node.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdmin();
  if (user instanceof Response) return user;

  const node = await resolveNode(params.id);
  if (!node) return Response.json({ error: 'Node tidak ditemukan' }, { status: 404 });

  const service = getSupabaseServiceClient();
  const availableOnly = request.nextUrl.searchParams.get('status') === 'available';

  let query = service
    .from('allocations')
    .select(ALLOCATION_SELECT, { count: 'exact' })
    .eq('node_id', node.id)
    .order('ip', { ascending: true })
    .order('port', { ascending: true })
    // Supabase membatasi jumlah baris per request; UI memberi tahu bila terpotong.
    .limit(1000);
  if (availableOnly) query = query.is('assigned_to', null);

  const [{ data, error, count }, { count: totalCount, error: totalError }] = await Promise.all([
    query,
    service.from('allocations').select('id', { count: 'exact', head: true }).eq('node_id', node.id),
  ]);
  if (error || totalError) {
    return Response.json({ error: error?.message ?? totalError?.message }, { status: 500 });
  }

  const rows = (data ?? []) as AllocationRow[];
  const allocations = await attachServers(rows);

  // Statistik selalu menggambarkan seluruh allocation node, bukan hanya hasil filter.
  const total = totalCount ?? rows.length;
  const available = availableOnly ? (count ?? rows.length) : rows.filter((row) => !row.assigned_to).length;
  const stats = { total, available, assigned: total - available };

  return Response.json({
    node: { id: node.id, name: node.name },
    allocations,
    stats,
    truncated: count !== null && count > rows.length,
  });
}

/**
 * POST /api/nodes/{id}/allocations — tambah port/range port (admin).
 * Body: { ip?: string, ports: string } — contoh ports: "25565-25600" atau "25565".
 * Duplikat (node+ip+port yang sudah ada) dilewati, bukan error.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const node = await resolveNode(params.id);
  if (!node) return Response.json({ error: 'Node tidak ditemukan' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { ip?: unknown; ports?: unknown; port?: unknown };
  const ip = typeof body.ip === 'string' && body.ip.trim() ? body.ip.trim() : '0.0.0.0';
  if (!isValidAllocationIp(ip)) {
    return Response.json({ error: 'IP tidak valid. Gunakan IPv4/IPv6 (contoh 0.0.0.0) atau hostname.' }, { status: 400 });
  }

  const spec = typeof body.ports === 'string' || typeof body.ports === 'number'
    ? String(body.ports)
    : typeof body.port === 'number' || typeof body.port === 'string'
      ? String(body.port)
      : '';
  const parsed = parsePortSpec(spec);
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });

  const service = getSupabaseServiceClient();
  const inserted: Array<Pick<AllocationRow, 'id' | 'ip' | 'port'>> = [];

  for (let i = 0; i < parsed.ports.length; i += INSERT_CHUNK) {
    const chunk = parsed.ports.slice(i, i + INSERT_CHUNK);
    const { data, error } = await service
      .from('allocations')
      .upsert(
        chunk.map((port) => ({ node_id: node.id, ip, port })),
        { onConflict: 'node_id,ip,port', ignoreDuplicates: true },
      )
      .select('id, ip, port');
    if (error) return Response.json({ error: error.message }, { status: 500 });
    for (const row of data ?? []) inserted.push(row as Pick<AllocationRow, 'id' | 'ip' | 'port'>);
  }

  const skipped = parsed.ports.length - inserted.length;
  await logActivity({
    userId: admin.id,
    action: 'node:allocation-create',
    metadata: {
      node: node.name,
      ip,
      ports: formatPortRanges(parsed.ports),
      inserted: inserted.length,
      skipped,
    },
  });

  return Response.json(
    {
      inserted: inserted.length,
      skipped,
      allocations: inserted,
      request: { ip, ports: formatPortRanges(parsed.ports) },
    },
    { status: inserted.length > 0 ? 201 : 200 },
  );
}

/**
 * DELETE /api/nodes/{id}/allocations?allocation_id={uuid}
 * Hanya allocation yang belum dipakai (`assigned_to IS NULL`) yang boleh dihapus.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const node = await resolveNode(params.id);
  if (!node) return Response.json({ error: 'Node tidak ditemukan' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { allocation_id?: unknown };
  const allocationId =
    request.nextUrl.searchParams.get('allocation_id') ??
    (typeof body.allocation_id === 'string' ? body.allocation_id : null);
  if (!allocationId) return Response.json({ error: 'allocation_id wajib diisi' }, { status: 400 });

  const service = getSupabaseServiceClient();
  const { data: allocation } = await service
    .from('allocations')
    .select(ALLOCATION_SELECT)
    .eq('id', allocationId)
    .eq('node_id', node.id)
    .maybeSingle();
  if (!allocation) return Response.json({ error: 'Allocation tidak ditemukan di node ini' }, { status: 404 });

  const row = allocation as AllocationRow;
  if (row.assigned_to) {
    const { data: server } = await service.from('servers').select('name').eq('id', row.assigned_to).maybeSingle();
    return Response.json(
      {
        error: `Port ${formatAllocation(row.ip, row.port)} sedang dipakai${
          server?.name ? ` oleh ${server.name}` : ' server lain'
        }. Lepas dari server dulu sebelum menghapus.`,
      },
      { status: 409 },
    );
  }

  // Syarat `assigned_to IS NULL` diulang di sini agar balapan dengan assign tetap aman.
  const { data: deleted, error } = await service
    .from('allocations')
    .delete()
    .eq('id', row.id)
    .is('assigned_to', null)
    .select('id');
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!deleted || deleted.length === 0) {
    return Response.json({ error: 'Port baru saja dipakai server lain; allocation tidak dihapus.' }, { status: 409 });
  }

  await logActivity({
    userId: admin.id,
    action: 'node:allocation-delete',
    metadata: { node: node.name, ip: row.ip, port: row.port },
  });

  return Response.json({ ok: true, deleted: { id: row.id, ip: row.ip, port: row.port } });
}
