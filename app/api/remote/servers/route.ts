import { NextRequest } from 'next/server';
import { authenticateWings } from '@/lib/remote/auth';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { buildProcessConfiguration, buildServerSettings, type EggProcessConfig } from '@/lib/remote/config';
import type { AllocationRow, ServerRow } from '@/types';

export const runtime = 'nodejs';

/**
 * GET /api/remote/servers?page=&per_page= — dipanggil Wings saat boot untuk
 * memulihkan daftar server yang harus ada di node ini.
 *
 * Response shape mengikuti wings remote.GetServers:
 * { data: [{ uuid, settings, process_configuration }], meta: { pagination } }
 */
export async function GET(request: NextRequest) {
  const node = await authenticateWings(request);
  if (node instanceof Response) return node;

  const perPage = Math.min(Number(request.nextUrl.searchParams.get('per_page')) || 50, 500);
  const page = Math.max(Number(request.nextUrl.searchParams.get('page')) || 1, 1);

  const service = getSupabaseServiceClient();
  const { data, count, error } = await service
    .from('servers')
    .select('*', { count: 'exact' })
    .eq('node_id', node.id)
    .order('created_at', { ascending: true })
    .range((page - 1) * perPage, page * perPage - 1);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const servers = (data ?? []) as ServerRow[];
  const allocationIds = servers
    .map((s) => s.allocation_id)
    .filter((v): v is string => typeof v === 'string');
  const serverIds = servers.map((s) => s.id);
  const eggIds = Array.from(new Set(servers.map((server) => server.egg_id).filter((id): id is string => Boolean(id))));
  const [{ data: primaryRows }, { data: assignedRows }, { data: eggConfigRows }] = await Promise.all([
    allocationIds.length
      ? service.from('allocations').select('*').in('id', allocationIds)
      : Promise.resolve({ data: [] as AllocationRow[] }),
    serverIds.length
      ? service.from('allocations').select('*').in('assigned_to', serverIds)
      : Promise.resolve({ data: [] as AllocationRow[] }),
    eggIds.length
      ? service.from('eggs').select('id, config_stop, config_startup').in('id', eggIds)
      : Promise.resolve({ data: [] as Array<{ id: string } & EggProcessConfig> }),
  ]);
  const primaryMap = new Map((primaryRows ?? []).map((a) => [a.id, a as AllocationRow]));
  const eggConfigById = new Map<string, EggProcessConfig>(
    (eggConfigRows ?? []).map((row) => [row.id as string, row as EggProcessConfig]),
  );
  const assignedMap = new Map<string, AllocationRow[]>();
  for (const allocation of (assignedRows ?? []) as AllocationRow[]) {
    if (!allocation.assigned_to) continue;
    const current = assignedMap.get(allocation.assigned_to) ?? [];
    current.push(allocation);
    assignedMap.set(allocation.assigned_to, current);
  }

  const out = servers.map((server) => {
    const assignedAllocations = assignedMap.get(server.id) ?? [];
    const primary = server.allocation_id
      ? (primaryMap.get(server.allocation_id) ?? assignedAllocations.find((a) => a.id === server.allocation_id) ?? null)
      : (assignedAllocations[0] ?? null);
    return {
      uuid: server.uuid,
      settings: buildServerSettings(server, primary, node.uuid, assignedAllocations),
      process_configuration: buildProcessConfiguration(
        server,
        server.egg_id ? eggConfigById.get(server.egg_id) : undefined,
      ),
    };
  });

  const total = count ?? out.length;
  return Response.json({
    data: out,
    meta: {
      pagination: {
        current_page: page,
        from: (page - 1) * perPage + 1,
        last_page: Math.max(Math.ceil(total / perPage), 1),
        per_page: perPage,
        to: Math.min(page * perPage, total),
        total,
      },
    },
  });
}
