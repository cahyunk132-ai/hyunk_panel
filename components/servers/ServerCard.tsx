'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from './StatusBadge';
import { useServerStatus } from '@/hooks/useServerStatus';
import type { ServerStatus } from '@/types';

export interface ServerCardData {
  id: string;
  uuid: string;
  name: string;
  status: ServerStatus;
  memory_mb: number;
  cpu_limit: number;
  is_suspended?: boolean;
  nodes?: { name: string; fqdn: string } | { name: string; fqdn: string }[] | null;
  allocations?: { ip: string; port: number } | { ip: string; port: number }[] | null;
}

function first<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/**
 * Kartu server pada list/dashboard. Status awal berasal dari DB lalu disegarkan
 * langsung dari Wings melalui REST setiap 30 detik selama tab terlihat.
 */
export function ServerCard({ server }: { server: ServerCardData }) {
  const node = first(server.nodes);
  const alloc = first(server.allocations);
  const { data: live, error } = useServerStatus(server.id, 30_000);
  const status = error ? 'offline' : live?.state ?? server.status;
  const isSuspended = server.is_suspended || live?.is_suspended;

  return (
    <Link href={`/servers/${server.id}`}>
      <Card className="group h-full px-5 py-4 transition-colors hover:border-accent/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink group-hover:text-accent">
              {server.name}
            </h3>
            <p className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">{server.uuid}</p>
          </div>
          <StatusBadge status={isSuspended ? 'error' : status} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 text-[11px] md:grid-cols-3">
          <div>
            <p className="text-ink-faint">RAM</p>
            <p className="mt-0.5 font-medium text-ink">{(server.memory_mb / 1024).toFixed(1)} GB</p>
          </div>
          <div>
            <p className="text-ink-faint">CPU</p>
            <p className="mt-0.5 font-medium text-ink">{server.cpu_limit}%</p>
          </div>
          <div>
            <p className="text-ink-faint">Port</p>
            <p className="mt-0.5 font-mono font-medium text-ink">{alloc?.port ?? '—'}</p>
          </div>
        </div>

        {node && (
          <p className="mt-3 truncate text-[11px] text-ink-faint">
            {node.name} · {node.fqdn}
          </p>
        )}
        {isSuspended && <p className="mt-2 text-[11px] font-medium text-red-400">⚠ Server disuspend</p>}
      </Card>
    </Link>
  );
}
