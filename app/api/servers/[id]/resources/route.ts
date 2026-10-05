import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { resolveServerWings } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/**
 * GET /api/servers/{id}/resources — snapshot status + utilization dari Wings,
 * lalu sinkronkan status ke DB (best effort). Untuk grafik realtime gunakan
 * WebSocket console (event "stats").
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'console', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  try {
    const info = await resolved.client.getResources(resolved.server.uuid);
    const u = info.utilization as Partial<{
      memory_bytes: number;
      cpu_absolute: number;
      network: { rx_bytes: number; tx_bytes: number };
      disk_bytes: number;
      uptime: number;
    }>;

    const mapStatus = (s: string) =>
      s === 'running' || s === 'starting' || s === 'stopping'
        ? s
        : s === 'installing'
          ? 'installing'
          : s === 'failed' || s === 'error'
            ? 'error'
            : 'offline';

    if (info.state && info.state !== resolved.server.status) {
      const service = getSupabaseServiceClient();
      await service
        .from('servers')
        .update({ status: mapStatus(info.state) })
        .eq('id', resolved.server.id);
    }

    return Response.json({
      state: info.state,
      is_suspended: info.is_suspended,
      memory_bytes: u.memory_bytes ?? 0,
      cpu_absolute: u.cpu_absolute ?? 0,
      disk_bytes: u.disk_bytes ?? 0,
      uptime: u.uptime ?? 0,
      network: u.network ?? { rx_bytes: 0, tx_bytes: 0 },
      memory_limit_mb: resolved.server.memory_mb,
    });
  } catch (err) {
    return Response.json(
      { error: 'Node tidak dapat dihubungi', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    );
  }
}
