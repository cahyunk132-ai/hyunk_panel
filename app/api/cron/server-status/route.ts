import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { requireCronSecret } from '@/lib/cron';
import { sendNotification } from '@/lib/notifications';
import { WingsClient } from '@/lib/wings/client';
import type { NodeRow, ServerStatus } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface MonitoredServer {
  id: string;
  uuid: string;
  name: string;
  node_id: string;
  owner_id: string | null;
  status: ServerStatus;
}

function mapWingsState(state: string | undefined): ServerStatus {
  switch (state) {
    case 'running':
    case 'starting':
    case 'stopping':
    case 'installing':
      return state;
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'offline';
  }
}

/**
 * GET /api/cron/server-status — fallback polling server state.
 * Endpoint tetap tersedia untuk pemanggilan manual atau scheduler eksternal.
 * A running → offline transition sends one crash email to that server owner.
 */
export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request);
  if (unauthorized) return unauthorized;

  const service = getSupabaseServiceClient();
  const [{ data: nodes, error: nodesError }, { data: servers, error: serversError }] = await Promise.all([
    service.from('nodes').select('*').order('created_at'),
    service.from('servers').select('id, uuid, name, node_id, owner_id, status').order('created_at'),
  ]);
  if (nodesError) return Response.json({ error: nodesError.message }, { status: 500 });
  if (serversError) return Response.json({ error: serversError.message }, { status: 500 });

  const nodeById = new Map((nodes ?? []).map((node) => [(node as NodeRow).id, node as NodeRow]));
  const serversByNode = new Map<string, MonitoredServer[]>();
  for (const raw of (servers ?? []) as MonitoredServer[]) {
    const list = serversByNode.get(raw.node_id) ?? [];
    list.push(raw);
    serversByNode.set(raw.node_id, list);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const nodeId of Array.from(serversByNode.keys())) {
    const nodeServers = serversByNode.get(nodeId) ?? [];
    const node = nodeById.get(nodeId);
    if (!node) {
      results.push({ node_id: nodeId, error: 'Node tidak ditemukan' });
      continue;
    }

    const currentByUuid = new Map<string, ServerStatus>();
    let nodeError: string | null = null;
    try {
      const client = new WingsClient(node);
      const liveServers = await client.getServers();
      for (const live of liveServers) {
        const uuid = live.configuration?.uuid;
        if (uuid) currentByUuid.set(uuid, mapWingsState(live.state));
      }
    } catch (err) {
      nodeError = err instanceof Error ? err.message.slice(0, 300) : 'Node tidak dapat dihubungi';
    }

    for (const server of nodeServers) {
      const currentStatus = nodeError ? 'offline' : currentByUuid.get(server.uuid) ?? 'offline';
      const changed = currentStatus !== server.status;
      let transitioned = false;
      if (changed) {
        const { data: updated } = await service
          .from('servers')
          .update({ status: currentStatus })
          .eq('id', server.id)
          .eq('status', server.status)
          .select('id');
        transitioned = Boolean(updated && updated.length > 0);
      }

      let notified = false;
      if (transitioned && server.status === 'running' && currentStatus === 'offline' && server.owner_id) {
        const notification = await sendNotification(server.owner_id, 'server_crash', {
          serverName: server.name,
          serverId: server.id,
          nodeName: node.name,
          nodeId: node.id,
          time: new Date(),
        });
        notified = notification.sent > 0;
      }

      results.push({
        server_id: server.id,
        name: server.name,
        node_id: node.id,
        previous_status: server.status,
        status: currentStatus,
        changed,
        notified,
        ...(nodeError ? { error: nodeError } : {}),
      });
    }
  }

  return Response.json({
    ok: true,
    checked: results.length,
    crashed: results.filter((result) => result.notified).length,
    results,
  });
}
