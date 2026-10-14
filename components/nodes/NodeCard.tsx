'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export interface NodeCardData {
  id: string;
  name: string;
  fqdn: string;
  location: string;
  is_maintenance: boolean;
  server_count?: number;
}

type NodeHealth = 'checking' | 'online' | 'offline';

function LiveNodeBadge({ health }: { health: NodeHealth }) {
  if (health === 'checking') return <Badge tone="yellow" spinning>Memeriksa…</Badge>;
  if (health === 'online') return <Badge tone="green">Online</Badge>;
  return <Badge tone="red">Offline</Badge>;
}

/**
 * Kartu node. Pada halaman Nodes, `pollStatus` mengaktifkan health check
 * langsung ke Wings saat halaman dibuka dan setiap 60 detik.
 */
export function NodeCard({
  node,
  pollStatus = false,
}: {
  node: NodeCardData;
  pollStatus?: boolean;
}) {
  const [health, setHealth] = useState<NodeHealth>('checking');

  useEffect(() => {
    if (!pollStatus) return;

    let active = true;
    let controller: AbortController | null = null;

    const check = async () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const res = await fetch(`/api/nodes/${node.id}/resources`, {
          cache: 'no-store',
          signal: requestController.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (active) setHealth('online');
      } catch {
        if (active && !requestController.signal.aborted) setHealth('offline');
      }
    };

    void check();
    const timer = window.setInterval(check, 60_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [node.id, pollStatus]);

  return (
    <Link href={`/nodes/${node.id}`}>
      <Card className="group h-full px-5 py-4 transition-colors hover:border-accent/30">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink group-hover:text-accent">{node.name}</h3>
            <p className="mt-0.5 font-mono text-[11px] text-ink-faint">{node.fqdn}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {node.is_maintenance && <Badge tone="yellow">Maintenance</Badge>}
            {pollStatus ? (
              <LiveNodeBadge health={health} />
            ) : (
              !node.is_maintenance && <Badge tone="green">Aktif</Badge>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4 text-[11px] text-ink-muted">
          <span>📍 {node.location}</span>
          {typeof node.server_count === 'number' && <span>🖥 {node.server_count} server</span>}
        </div>
      </Card>
    </Link>
  );
}
