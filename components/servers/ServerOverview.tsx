'use client';

import { Card, CardHeader } from '@/components/ui/Card';
import { PowerButtons } from '@/components/servers/PowerButtons';
import { ResourceMonitor } from '@/components/servers/ResourceMonitor';
import { Badge } from '@/components/ui/Badge';
import { useServerStatus } from '@/hooks/useServerStatus';

export function ServerOverview({
  serverId,
  dbStatus,
  memoryMb,
  cpuLimit,
  diskMb,
  isSuspended,
}: {
  serverId: string;
  dbStatus: string;
  memoryMb: number;
  cpuLimit: number;
  diskMb: number | null;
  isSuspended: boolean;
}) {
  // Polling ringan untuk status tombol daya (juga me-resync status ke DB tiap 15 dtk).
  // Grafik realtime memakai WebSocket lewat ResourceMonitor.
  const { data } = useServerStatus(serverId);
  const status = data?.state ?? dbStatus;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Kontrol daya"
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone="accent">RAM {(memoryMb / 1024).toFixed(1)} GB</Badge>
              <Badge tone="accent">CPU {cpuLimit}%</Badge>
              {isSuspended && <Badge tone="red">Suspended — kontrol dinonaktifkan</Badge>}
            </span>
          }
          action={<PowerButtons serverId={serverId} status={status} disabled={isSuspended} />}
        />
      </Card>

      <ResourceMonitor
        serverId={serverId}
        dbStatus={status}
        memoryMb={memoryMb}
        cpuLimit={cpuLimit}
        diskMb={diskMb}
      />
    </div>
  );
}
