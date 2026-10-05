'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface LiveServerStatus {
  state: string;
  is_suspended: boolean;
  memory_bytes: number;
  cpu_absolute: number;
  disk_bytes: number;
  uptime: number;
  network: { rx_bytes: number; tx_bytes: number };
  memory_limit_mb: number;
}

/**
 * Polling ringan ke /api/servers/{id}/resources.
 * Interval default 15 detik; berhenti saat tab tidak terlihat.
 */
export function useServerStatus(serverId: string, intervalMs = 15_000) {
  const [data, setData] = useState<LiveServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/resources`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as LiveServerStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat status');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      if (document.visibilityState === 'visible') {
        await fetchStatus();
      }
      if (!stopped) timer.current = setTimeout(tick, intervalMs);
    }
    tick();
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [fetchStatus, intervalMs]);

  return { data, error, loading, refresh: fetchStatus };
}
