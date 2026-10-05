import { requireUser } from '@/lib/auth/session';
import { WingsClient } from '@/lib/wings/client';
import { getNodeById } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/**
 * GET /api/nodes/{id}/resources
 * Info sistem realtime langsung dari Wings:
 *  - GET /api/system?v=2      → CPU threads, total RAM, versi wings
 *  - GET /api/servers         → daftar server + state + utilization live
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (user.role !== 'admin') {
    return Response.json({ error: 'Butuh akses admin' }, { status: 403 });
  }

  const node = await getNodeById(params.id);
  if (!node) return Response.json({ error: 'Node tidak ditemukan' }, { status: 404 });

  try {
    const client = new WingsClient(node);
    const [system, servers] = await Promise.all([client.getSystemInformation(), client.getServers()]);
    return Response.json({
      system: {
        version: system.version ?? null,
        architecture: system.system?.architecture ?? null,
        cpu_threads: system.system?.cpu_threads ?? null,
        memory_bytes: system.system?.memory_bytes ?? null,
        os: system.system?.os_type ?? system.system?.os ?? null,
        kernel: system.system?.kernel_version ?? null,
      },
      servers: servers.map((s) => ({
        uuid: s.configuration?.uuid ?? null,
        name: s.configuration?.meta?.name ?? null,
        state: s.state,
        is_suspended: s.is_suspended,
        memory_bytes: s.utilization?.memory_bytes ?? 0,
        cpu_absolute: s.utilization?.cpu_absolute ?? 0,
        disk_bytes: 0,
        uptime: s.utilization?.uptime ?? 0,
        network: s.utilization?.network ?? { rx_bytes: 0, tx_bytes: 0 },
      })),
    });
  } catch (err) {
    return Response.json(
      {
        error: 'Node tidak dapat dihubungi',
        detail: err instanceof Error ? err.message : 'unknown',
      },
      { status: 502 },
    );
  }
}
