import { getSupabaseServiceClient, isSupabaseServerConfigured } from '@/lib/supabase/server';
import type {
  NodeStatus,
  PublicNodeStatus,
  PublicStatusOverall,
  PublicStatusResponse,
} from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HISTORY_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

interface StatusLog {
  node_id: string;
  status: NodeStatus;
  latency_ms: number | null;
  checked_at: string;
}

function dayKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

function severity(status: NodeStatus): number {
  return status === 'offline' ? 3 : status === 'degraded' ? 2 : 1;
}

function worstStatus(a: NodeStatus | undefined, b: NodeStatus): NodeStatus {
  return !a || severity(b) > severity(a) ? b : a;
}

function overallFor(nodes: PublicNodeStatus[]): PublicStatusOverall {
  if (nodes.length === 0 || nodes.every((node) => node.status === 'online')) return 'operational';
  const offline = nodes.filter((node) => node.status === 'offline').length;
  return offline === nodes.length ? 'major_outage' : 'degraded';
}

/** GET /api/status — public node status + 90-day check history. */
export async function GET() {
  const headers = { 'Cache-Control': 'no-store, max-age=0' };
  if (!isSupabaseServerConfigured()) {
    const empty: PublicStatusResponse = { nodes: [], overall: 'operational', last_updated: null };
    return Response.json(empty, { headers });
  }

  const service = getSupabaseServiceClient();
  const since = new Date(Date.now() - HISTORY_DAYS * DAY_MS).toISOString();
  const [{ data: nodes, error: nodeError }, { data: logs, error: logError }] = await Promise.all([
    service.from('nodes').select('id, name, location').order('created_at', { ascending: true }),
    service
      .from('node_status_logs')
      .select('node_id, status, latency_ms, checked_at')
      .gte('checked_at', since)
      .order('checked_at', { ascending: true })
      .limit(100_000),
  ]);

  if (nodeError || logError) {
    return Response.json(
      { error: nodeError?.message ?? logError?.message ?? 'Status belum tersedia' },
      { status: 500, headers },
    );
  }

  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const historyKeys = Array.from({ length: HISTORY_DAYS }, (_, index) =>
    dayKey(new Date(now.getTime() - (HISTORY_DAYS - 1 - index) * DAY_MS)),
  );
  const logsByNode = new Map<string, StatusLog[]>();
  const latestByNode = new Map<string, StatusLog>();
  let lastUpdated: string | null = null;

  for (const raw of (logs ?? []) as StatusLog[]) {
    const list = logsByNode.get(raw.node_id) ?? [];
    list.push(raw);
    logsByNode.set(raw.node_id, list);

    const latest = latestByNode.get(raw.node_id);
    if (!latest || new Date(raw.checked_at).getTime() > new Date(latest.checked_at).getTime()) {
      latestByNode.set(raw.node_id, raw);
    }
    if (!lastUpdated || new Date(raw.checked_at).getTime() > new Date(lastUpdated).getTime()) {
      lastUpdated = raw.checked_at;
    }
  }

  const publicNodes: PublicNodeStatus[] = ((nodes ?? []) as Array<{
    id: string;
    name: string;
    location: string | null;
  }>).map((node) => {
    const nodeLogs = logsByNode.get(node.id) ?? [];
    const daily = new Map<string, NodeStatus>();
    for (const log of nodeLogs) {
      daily.set(dayKey(log.checked_at), worstStatus(daily.get(dayKey(log.checked_at)), log.status));
    }

    const latest = latestByNode.get(node.id);
    const onlineChecks = nodeLogs.filter((log) => log.status === 'online').length;
    const uptime = nodeLogs.length > 0 ? (onlineChecks / nodeLogs.length) * 100 : 0;

    return {
      id: node.id,
      name: node.name,
      location: node.location,
      status: latest?.status ?? 'offline',
      latency_ms: latest?.latency_ms ?? null,
      uptime_90d: Math.round(uptime * 10) / 10,
      history: historyKeys.map((key) => daily.get(key) ?? null),
    };
  });

  const response: PublicStatusResponse = {
    nodes: publicNodes,
    overall: overallFor(publicNodes),
    last_updated: lastUpdated,
  };
  return Response.json(response, { headers });
}
