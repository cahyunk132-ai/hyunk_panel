'use client';

import { Card, CardHeader } from '@/components/ui/Card';
import { Sparkline } from '@/components/charts/Sparkline';
import { StatusDot } from '@/components/servers/StatusBadge';
import { useWingsStats } from '@/hooks/useWingsStats';
import { formatBytes, formatUptime } from '@/lib/utils/format';

/**
 * Grafik monitoring realtime (CPU, RAM, network, disk) dari stream
 * "stats" websocket Wings — sampel ±1 detik, window ±2 menit.
 */
export function ResourceMonitor({
  serverId,
  dbStatus,
  memoryMb,
  cpuLimit,
}: {
  serverId: string;
  dbStatus: string;
  memoryMb: number;
  cpuLimit: number;
}) {
  const { samples, state, connected, error } = useWingsStats(serverId);

  const status = samples.length > 0 ? (samples[samples.length - 1].state ?? state) : (state === 'offline' ? dbStatus : state);
  const memoryLimitBytes = samples.find((s) => s.memory_limit_bytes > 0)?.memory_limit_bytes ?? memoryMb * 1024 * 1024;

  const cpuData = samples.map((s) => s.cpu_percent);
  const memData = samples.map((s) => s.memory_bytes);
  const rxData = samples.map((s) => s.rx_per_sec);
  const txData = samples.map((s) => s.tx_per_sec);
  const latest = samples[samples.length - 1];

  return (
    <Card>
      <CardHeader
        title="Resource monitoring"
        subtitle={
          latest
            ? `Live · disk ${formatBytes(latest.disk_bytes)} · uptime ${formatUptime(latest.uptime)}`
            : 'Menunggu stream stats dari node…'
        }
        action={
          <div className="flex items-center gap-2 text-xs">
            <StatusDot status={status} />
            <span className="font-medium text-ink">{status}</span>
            <span
              className={`ml-2 flex items-center gap-1 ${
                connected ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400 dot-pulse'}`} />
              {connected ? 'live' : error ? 'reconnecting…' : 'menghubungkan…'}
            </span>
          </div>
        }
      />
      <div className="grid gap-x-8 gap-y-5 px-5 py-5 md:grid-cols-2">
        <Sparkline
          label="CPU"
          data={cpuData}
          domainMax={Math.max(cpuLimit, ...cpuData, 100)}
          stroke="#3ecfcf"
          formatValue={(v) => `${v.toFixed(1)}%`}
          caption={`limit ${cpuLimit}%`}
        />
        <Sparkline
          label="Memory"
          data={memData}
          domainMax={memoryLimitBytes}
          stroke="#7c8cf8"
          formatValue={formatBytes}
          caption={`limit ${formatBytes(memoryLimitBytes)}`}
        />
        <Sparkline
          label="Network masuk (RX/s)"
          data={rxData}
          stroke="#34d399"
          formatValue={(v) => `${formatBytes(v)}/s`}
        />
        <Sparkline
          label="Network keluar (TX/s)"
          data={txData}
          stroke="#f59e0b"
          formatValue={(v) => `${formatBytes(v)}/s`}
        />
      </div>
    </Card>
  );
}
