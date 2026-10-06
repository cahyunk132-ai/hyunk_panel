'use client';

import { Card, CardHeader } from '@/components/ui/Card';
import { Sparkline } from '@/components/charts/Sparkline';
import { StatusDot } from '@/components/servers/StatusBadge';
import { useWingsStats } from '@/hooks/useWingsStats';
import { formatBytes, formatUptime } from '@/lib/utils/format';

function DiskUsage({ usedBytes, limitMb }: { usedBytes: number; limitMb: number | null }) {
  const limitBytes = (limitMb ?? 0) * 1024 * 1024;
  const pct = limitBytes > 0 ? Math.min(100, (usedBytes / limitBytes) * 100) : 0;
  const tone = pct >= 90 ? 'bg-red-400' : pct >= 75 ? 'bg-amber-400' : 'bg-[#c084fc]';

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Disk usage
        </p>
        <p className="font-mono text-sm font-semibold text-ink">
          {formatBytes(usedBytes)}
          <span className="text-ink-faint">
            {' '}
            / {limitBytes > 0 ? formatBytes(limitBytes) : 'tanpa limit'}
          </span>
        </p>
      </div>

      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-base-700"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Disk usage"
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${tone}`}
          style={{ width: `${limitBytes > 0 ? pct : 100}%`, opacity: limitBytes > 0 ? 1 : 0.35 }}
        />
      </div>

      <div className="flex items-center justify-between font-mono text-[10px] text-ink-faint">
        <span>{limitBytes > 0 ? `${pct.toFixed(1)}% terpakai` : 'limit belum diset di panel'}</span>
        {limitBytes > 0 && <span>sisa {formatBytes(Math.max(limitBytes - usedBytes, 0))}</span>}
      </div>
    </div>
  );
}

/**
 * Grafik monitoring realtime (CPU, RAM, network, disk) dari stream
 * "stats" websocket Wings — sampel ±1 detik, window ±2 menit.
 */
export function ResourceMonitor({
  serverId,
  dbStatus,
  memoryMb,
  cpuLimit,
  diskMb,
}: {
  serverId: string;
  dbStatus: string;
  memoryMb: number;
  cpuLimit: number;
  diskMb: number | null;
}) {
  const { samples, state, connected, error } = useWingsStats(serverId);

  const status = samples.length > 0 ? (samples[samples.length - 1].state ?? state) : (state === 'offline' ? dbStatus : state);
  const memoryLimitBytes = samples.find((s) => s.memory_limit_bytes > 0)?.memory_limit_bytes ?? memoryMb * 1024 * 1024;

  const cpuData = samples.map((s) => s.cpu_percent);
  const memData = samples.map((s) => s.memory_bytes);
  const rxData = samples.map((s) => s.rx_per_sec);
  const txData = samples.map((s) => s.tx_per_sec);
  const latest = samples[samples.length - 1];
  const latestRxRate = rxData[rxData.length - 1] ?? 0;
  const latestTxRate = txData[txData.length - 1] ?? 0;

  return (
    <Card>
      <CardHeader
        title="Resource monitoring"
        subtitle={
          latest
            ? `Live · uptime ${formatUptime(latest.uptime)}`
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
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 px-5 py-5 md:grid-cols-2">
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
          label="Network"
          data={rxData}
          data2={txData}
          stroke="#34d399"
          stroke2="#f59e0b"
          formatValue={(v) => `${formatBytes(v)}/s`}
          headerRight={
            latest ? (
              <span className="whitespace-nowrap text-[13px]">
                <span className="text-[#f59e0b]">↑ {formatBytes(latest.tx_bytes)}</span>
                {'  '}
                <span className="text-[#34d399]">↓ {formatBytes(latest.rx_bytes)}</span>
              </span>
            ) : undefined
          }
          footer={
            <>
              <span>
                ↑ {formatBytes(latestTxRate)}/s ↓ {formatBytes(latestRxRate)}/s
              </span>
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-3 rounded-full bg-[#34d399]" /> in
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-3 rounded-full bg-[#f59e0b]" /> out
                </span>
              </span>
            </>
          }
        />
        <DiskUsage usedBytes={latest?.disk_bytes ?? 0} limitMb={diskMb} />
      </div>
    </Card>
  );
}
