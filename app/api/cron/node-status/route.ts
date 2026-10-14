import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { requireCronSecret } from '@/lib/cron';
import { sendNotification } from '@/lib/notifications';
import { WingsClient } from '@/lib/wings/client';
import type { NodeRow, NodeStatus } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const RETENTION_DAYS = 90;
const DEGRADED_LATENCY_MS = 1_000;

interface NodeCheckResult {
  node_id: string;
  name: string;
  status: NodeStatus;
  latency_ms: number | null;
  notified: boolean;
  error?: string;
}

/**
 * GET /api/cron/node-status — health check publik setiap jam.
 *
 * Vercel Cron harus mengirim Authorization: Bearer CRON_SECRET. Token Wings
 * hanya didekripsi inside WingsClient di server dan tidak pernah masuk response.
 */
export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const service = getSupabaseServiceClient();
  const { data: nodes, error } = await service.from('nodes').select('*').order('created_at');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results: NodeCheckResult[] = [];
  for (const rawNode of (nodes ?? []) as NodeRow[]) {
    const node = rawNode;
    const { data: previous } = await service
      .from('node_status_logs')
      .select('status')
      .eq('node_id', node.id)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const startedAt = Date.now();
    let status: NodeStatus = 'offline';
    let latency: number | null = null;
    let errorMessage: string | undefined;

    try {
      const client = new WingsClient(node);
      await client.ping();
      latency = Math.max(0, Date.now() - startedAt);
      status = node.is_maintenance || latency >= DEGRADED_LATENCY_MS ? 'degraded' : 'online';
    } catch (err) {
      errorMessage = err instanceof Error ? err.message.slice(0, 300) : 'Node tidak dapat dihubungi';
    }

    const { error: insertError } = await service.from('node_status_logs').insert({
      node_id: node.id,
      status,
      latency_ms: latency,
    });
    if (insertError) {
      results.push({
        node_id: node.id,
        name: node.name,
        status,
        latency_ms: latency,
        notified: false,
        error: `Gagal menyimpan log: ${insertError.message}`,
      });
      continue;
    }

    let notified = false;
    if (previous?.status === 'online' && status === 'offline') {
      const notification = await sendNotification('all_admins', 'node_offline', {
        nodeName: node.name,
        nodeId: node.id,
        time: new Date(),
      });
      notified = notification.sent > 0;
    }

    results.push({
      node_id: node.id,
      name: node.name,
      status,
      latency_ms: latency,
      notified,
      ...(errorMessage ? { error: errorMessage } : {}),
    });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: cleanedRows, error: cleanupError } = await service
    .from('node_status_logs')
    .delete()
    .lt('checked_at', cutoff)
    .select('id');

  return Response.json({
    ok: !cleanupError,
    checked: results.length,
    retained_since: cutoff,
    cleaned: cleanupError ? 0 : cleanedRows?.length ?? 0,
    results,
    ...(cleanupError ? { cleanup_error: cleanupError.message } : {}),
  });
}
