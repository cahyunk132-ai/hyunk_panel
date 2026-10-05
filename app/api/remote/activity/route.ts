import { NextRequest } from 'next/server';
import { authenticateWings } from '@/lib/remote/auth';
import { getSupabaseServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

interface WingsActivityEvent {
  user?: string;
  server?: string;
  event?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  timestamp?: string;
}

/**
 * POST /api/remote/activity — batch activity dari Wings
 * (header X-Activity-Source: wings; body bisa {data: [...]} atau array tunggal).
 */
export async function POST(request: NextRequest) {
  const node = await authenticateWings(request);
  if (node instanceof Response) return node;

  const body = (await request.json().catch(() => null)) as
    | WingsActivityEvent
    | WingsActivityEvent[]
    | { data?: WingsActivityEvent[] }
    | null;
  if (!body) return Response.json({ error: 'Body bukan JSON valid' }, { status: 400 });

  const events: WingsActivityEvent[] = Array.isArray(body)
    ? body
    : Array.isArray((body as { data?: WingsActivityEvent[] }).data)
      ? (body as { data: WingsActivityEvent[] }).data
      : [body as WingsActivityEvent];
  if (events.length === 0) return new Response(null, { status: 204 });

  // Map uuid server → id internal (hanya server di node ini).
  const uuids = events.map((e) => e.server).filter((v): v is string => !!v);
  const service = getSupabaseServiceClient();
  const { data: servers } = uuids.length
    ? await service.from('servers').select('id, uuid').eq('node_id', node.id).in('uuid', uuids)
    : { data: [] };
  const serverMap = new Map((servers ?? []).map((s) => [s.uuid as string, s.id as string]));

  const rows = events
    .filter((e) => e.event)
    .map((e) => ({
      user_id: null,
      server_id: e.server ? (serverMap.get(e.server) ?? null) : null,
      action: `wings:${e.event}`,
      metadata: {
        ...(e.metadata ?? {}),
        wings_user: e.user ?? null,
        wings_timestamp: e.timestamp ?? null,
      },
      ip: e.ip ?? null,
    }));

  if (rows.length > 0) {
    await service.from('activity_logs').insert(rows);
  }
  return new Response(null, { status: 204 });
}
