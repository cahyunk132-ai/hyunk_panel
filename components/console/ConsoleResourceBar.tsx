'use client';

import { useServerStatus } from '@/hooks/useServerStatus';
import { formatBytes, formatUptime } from '@/lib/utils/format';

function MiniBar({ pct, tone = 'bg-accent' }: { pct: number; tone?: string }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <span className="h-1 w-16 overflow-hidden rounded-full bg-base-700">
      <span
        className={`block h-full rounded-full transition-all duration-500 ${tone}`}
        style={{ width: `${clamped}%` }}
      />
    </span>
  );
}

function Item({
  label,
  value,
  bar,
}: {
  label: string;
  value: string;
  bar?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      <span className="font-mono text-xs font-semibold text-ink">{value}</span>
      {bar}
    </div>
  );
}

/**
 * Bar resource di atas console — polling REST /api/servers/{id}/resources
 * tiap 3 detik (CPU, RAM, disk, uptime, network in/out gabungan).
 * Limit CPU/disk statis di-pass sebagai props dari server component.
 */
export function ConsoleResourceBar({
  serverId,
  cpuLimit,
  diskMb,
}: {
  serverId: string;
  cpuLimit: number;
  diskMb: number | null;
}) {
  const { data, error } = useServerStatus(serverId, 3000);

  const memLimitBytes = (data?.memory_limit_mb ?? 0) * 1024 * 1024;
  const diskLimitBytes = (diskMb ?? 0) * 1024 * 1024;

  const cpuPct = data ? data.cpu_absolute : 0;
  const memPct = data && memLimitBytes > 0 ? (data.memory_bytes / memLimitBytes) * 100 : 0;
  const diskPct =
    data && diskLimitBytes > 0 ? (data.disk_bytes / diskLimitBytes) * 100 : 0;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-base-850 px-4 py-2.5">
      {!data ? (
        <span className="font-mono text-[11px] text-ink-faint">
          {error ? `stat tidak tersedia (${error})` : 'memuat resource…'}
        </span>
      ) : (
        <>
          <Item
            label="CPU"
            value={`${cpuPct.toFixed(0)}%`}
            bar={
              <MiniBar
                pct={cpuLimit > 0 ? (cpuPct / cpuLimit) * 100 : cpuPct}
                tone="bg-[#3ecfcf]"
              />
            }
          />
          <Item
            label="RAM"
            value={
              memLimitBytes > 0
                ? `${formatBytes(data.memory_bytes)} / ${formatBytes(memLimitBytes)}`
                : formatBytes(data.memory_bytes)
            }
            bar={<MiniBar pct={memPct} tone="bg-[#7c8cf8]" />}
          />
          <Item
            label="Disk"
            value={
              diskLimitBytes > 0
                ? `${formatBytes(data.disk_bytes)} / ${formatBytes(diskLimitBytes)}`
                : formatBytes(data.disk_bytes)
            }
            bar={diskLimitBytes > 0 ? <MiniBar pct={diskPct} tone="bg-[#c084fc]" /> : undefined}
          />
          <Item label="UP" value={formatUptime(data.uptime)} />
          <Item
            label="NET"
            value={`↑ ${formatBytes(data.network.tx_bytes)} ↓ ${formatBytes(data.network.rx_bytes)}`}
          />
        </>
      )}
    </div>
  );
}
