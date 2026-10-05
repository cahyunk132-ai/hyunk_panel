import { NextRequest } from 'next/server';
import { authenticateWings } from '@/lib/remote/auth';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { buildProcessConfiguration, buildServerSettings } from '@/lib/remote/config';
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
  const { data: allocations } = allocationIds.length
    ? await service.from('allocations').select('*').in('id', allocationIds)
    : { data: [] as AllocationRow[] };
  const allocMap = new Map((allocations ?? []).map((a) => [a.id, a]));

  const out = servers.map((server) => ({
    uuid: server.uuid,
    settings: buildServerSettings(
      server,
      server.allocation_id ? (allocMap.get(server.allocation_id) ?? null) : null,
      node.uuid,
    ),
    process_configuration: buildProcessConfiguration(server),
  }));

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
