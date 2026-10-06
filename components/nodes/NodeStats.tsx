'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusDot } from '@/components/servers/StatusBadge';
import { formatBytes, formatUptime } from '@/lib/utils/format';

interface NodeResources {
  system: {
    version: string | null;
    architecture: string | null;
    cpu_threads: number | null;
    memory_bytes: number | null;
    os: string | null;
    kernel: string | null;
  };
  servers: Array<{
    uuid: string | null;
    name: string | null;
    state: string;
    is_suspended: boolean;
    memory_bytes: number;
    cpu_absolute: number;
    uptime: number;
    network: { rx_bytes: number; tx_bytes: number };
  }>;
}

/** Statistik live node — polling /api/nodes/{id}/resources tiap 20 detik. */
export function NodeStats({ nodeId }: { nodeId: string }) {
  const [data, setData] = useState<NodeResources | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const res = await fetch(`/api/nodes/${nodeId}/resources`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.detail || json.error || `HTTP ${res.status}`);
        if (!stopped) {
          setData(json as NodeResources);
          setError(null);
        }
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : 'Gagal');
      }
    }
    tick();
    const t = setInterval(tick, 20_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [nodeId]);

  if (error) {
    return (
      <Card className="px-5 py-4">
        <p className="text-sm text-red-400">Node tidak dapat dihubungi: {error}</p>
        <p className="mt-1 text-xs text-ink-muted">
          Pastikan Wings berjalan dan HTTPS aktif. Panel hanya bisa membaca setelah token node valid.
        </p>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="px-5 py-6 text-center text-sm text-ink-faint">
        Mengambil data live dari node…
      </Card>
    );
  }

  const totalMem = data.system.memory_bytes ?? 0;
  const usedMem = data.servers.reduce((acc, s) => acc + (s.memory_bytes ?? 0), 0);
  const memPct = totalMem > 0 ? Math.min((usedMem / totalMem) * 100, 100) : 0;
  const totalCpu = data.servers.reduce((acc, s) => acc + (s.cpu_absolute ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-ink-faint">RAM dipakai server</p>
          <p className="mt-1.5 text-xl font-bold">
            {formatBytes(usedMem)}
            <span className="ml-1 text-sm font-normal text-ink-muted">/ {formatBytes(totalMem)}</span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-base-600">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${memPct}%` }} />
          </div>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-ink-faint">CPU total</p>
          <p className="mt-1.5 text-xl font-bold">
            {totalCpu.toFixed(0)}%
            <span className="ml-1 text-sm font-normal text-ink-muted">
              dari {data.system.cpu_threads ?? '—'} thread
            </span>
          </p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-ink-faint">Wings</p>
          <p className="mt-1.5 font-mono text-sm text-ink">
            v{data.system.version ?? '?'} · {data.system.architecture ?? '?'}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] text-ink-faint">
            {data.system.os} {data.system.kernel}
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Server di node ini (live)" subtitle="Langsung dari Wings, refresh tiap 20 detik" />
        <div className="divide-y divide-line-soft">
          {data.servers.length === 0 && (
            <p className="px-5 py-6 text-center text-sm text-ink-faint">
              Wings tidak melaporkan server apapun.
            </p>
          )}
          {data.servers.map((s) => (
            <div key={s.uuid ?? s.name} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <StatusDot status={s.state} />
              <span className="font-medium text-ink">{s.name ?? '—'}</span>
              <span className="font-mono text-[11px] text-ink-faint">{s.uuid ?? ''}</span>
              <div className="ml-auto flex items-center gap-4 font-mono text-[11px] text-ink-muted">
                <span>{s.cpu_absolute.toFixed(0)}% CPU</span>
                <span>{formatBytes(s.memory_bytes)} RAM</span>
                {s.uptime > 0 && <span>{formatUptime(s.uptime)}</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
