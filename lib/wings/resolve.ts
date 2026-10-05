import 'server-only';
import type { NodeRow, ServerRow } from '@/types';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { WingsClient } from './client';

export interface ResolvedServer {
  server: ServerRow;
  node: NodeRow;
  client: WingsClient;
}

/**
 * Resolve server → node → WingsClient (token didekripsi di memori).
 * Dipakai SEMUA API route yang berbicara dengan Wings.
 */
export async function resolveServerWings(server: ServerRow): Promise<ResolvedServer | Response> {
  const service = getSupabaseServiceClient();
  const { data: node } = await service
    .from('nodes')
    .select('*')
    .eq('id', server.node_id)
    .maybeSingle();
  if (!node) {
    return Response.json({ error: 'Node untuk server ini tidak ditemukan' }, { status: 502 });
  }
  const nodeRow = node as NodeRow;
  try {
    const client = new WingsClient(nodeRow);
    return { server, node: nodeRow, client };
  } catch (err) {
    return Response.json(
      { error: `Gagal menyiapkan koneksi node: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 500 },
    );
  }
}

export async function getNodeById(nodeIdOrUuid: string): Promise<NodeRow | null> {
  const service = getSupabaseServiceClient();
  const { data } = await service
    .from('nodes')
    .select('*')
    .or(`id.eq.${nodeIdOrUuid},uuid.eq.${nodeIdOrUuid}`)
    .maybeSingle();
  return (data as NodeRow | null) ?? null;
}

/** Catat activity log (best-effort, tidak pernah melempar error). */
export async function logActivity(input: {
  userId?: string | null;
  serverId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    const service = getSupabaseServiceClient();
    await service.from('activity_logs').insert({
      user_id: input.userId ?? null,
      server_id: input.serverId ?? null,
      action: input.action,
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
    });
  } catch {
    // sengaja ditelan — logging tidak boleh menggagalkan request utama
  }
}
