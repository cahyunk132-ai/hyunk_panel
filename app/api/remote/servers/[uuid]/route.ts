import { NextRequest } from 'next/server';
import { authenticateWings } from '@/lib/remote/auth';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { buildProcessConfiguration, buildServerSettings } from '@/lib/remote/config';
import type { AllocationRow, ServerRow } from '@/types';

export const runtime = 'nodejs';

/**
 * GET /api/remote/servers/{uuid} — konfigurasi penuh satu server.
 * Dipanggil wings saat create/sync/start server.
 */
export async function GET(request: NextRequest, { params }: { params: { uuid: string } }) {
  const node = await authenticateWings(request);
  if (node instanceof Response) return node;

  const service = getSupabaseServiceClient();
  const { data: server } = await service
    .from('servers')
    .select('*')
    .eq('uuid', params.uuid)
    .eq('node_id', node.id)
    .maybeSingle();
  if (!server) {
    return Response.json(
      { error: 'Server tidak ditemukan di node ini' },
      { status: 404 },
    );
  }

  const typed = server as ServerRow;
  let allocation: AllocationRow | null = null;
  if (typed.allocation_id) {
    const { data } = await service
      .from('allocations')
      .select('*')
      .eq('id', typed.allocation_id)
      .maybeSingle();
    allocation = (data as AllocationRow | null) ?? null;
  }

  return Response.json({
    settings: buildServerSettings(typed, allocation, node.uuid),
    process_configuration: buildProcessConfiguration(typed),
  });
}
