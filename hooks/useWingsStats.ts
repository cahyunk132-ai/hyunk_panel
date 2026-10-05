'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WingsStatsPayload } from '@/lib/wings/types';

export interface StatsSample {
  t: number; // epoch ms
  state: string;
  cpu_percent: number;
  memory_bytes: number;
  memory_limit_bytes: number;
  disk_bytes: number;
  uptime: number;
  rx_per_sec: number; // bytes/detik (rate dari delta antar sampel)
  tx_per_sec: number;
}

const MAX_SAMPLES = 120; // ~2 menit pada 1 sampel/detik

interface RawStats extends WingsStatsPayload {
  state: string;
}

/**
 * Hook statistik realtime — WebSocket ringan ke Wings yang hanya berlangganan
 * event "stats" + "status". Dipakai halaman Overview/grafik monitoring.
 * Koneksi diputus otomatis saat tab tidak terlihat (hemat resource).
 */
export function useWingsStats(serverId: string, enabled = true) {
  const [samples, setSamples] = useState<StatsSample[]>([]);
  const [state, setState] = useState<string>('offline');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const unmounted = useRef(false);
  const manualClose = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const prevNet = useRef<{ t: number; rx: number; tx: number } | null>(null);

  const disconnect = useCallback(() => {
    manualClose.current = true;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  const connect = useCallback(async () => {
    if (!enabled || unmounted.current) return;
    manualClose.current = false;

    let socket: string;
    let token: string;
    try {
      const res = await fetch(`/api/servers/${serverId}/console/token`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      socket = json.socket as string;
      token = json.token as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengambil token');
      reconnectTimer.current = setTimeout(connect, 7000);
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(socket);
    } catch {
      setError('URL WebSocket tidak valid');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ event: 'auth', args: [token] }));
    };

    ws.onmessage = (ev) => {
      if (unmounted.current) return;
      let msg: { event?: string; args?: string[] };
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '{}');
      } catch {
        return;
      }

      switch (msg.event) {
        case 'auth success':
          reconnectAttempt.current = 0;
          setConnected(true);
          setError(null);
          ws.send(JSON.stringify({ event: 'send stats' }));
          break;
        case 'status':
          if (msg.args?.[0]) setState(msg.args[0]);
          break;
        case 'stats': {
          if (!msg.args?.[0]) break;
          let raw: RawStats;
          try {
            raw = JSON.parse(msg.args[0]) as RawStats;
          } catch {
            break;
          }
          const now = Date.now();
          const prev = prevNet.current;
          const dt = prev ? Math.max((now - prev.t) / 1000, 0.2) : 1;
          const rxRate = prev ? Math.max((raw.network.rx_bytes - prev.rx) / dt, 0) : 0;
          const txRate = prev ? Math.max((raw.network.tx_bytes - prev.tx) / dt, 0) : 0;
          prevNet.current = { t: now, rx: raw.network.rx_bytes, tx: raw.network.tx_bytes };

          if (raw.state) setState(raw.state);
          setSamples((old) => {
            const next: StatsSample[] = [
              ...old,
              {
                t: now,
                state: raw.state ?? 'offline',
                cpu_percent: raw.cpu_absolute ?? 0,
                memory_bytes: raw.memory_bytes ?? 0,
                memory_limit_bytes: raw.memory_limit_bytes ?? 0,
                disk_bytes: raw.disk_bytes ?? 0,
                uptime: raw.uptime ?? 0,
                rx_per_sec: rxRate,
                tx_per_sec: txRate,
              },
            ];
            return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
          });
          break;
        }
        case 'token expiring':
        case 'token expired': {
          fetch(`/api/servers/${serverId}/console/token`, { method: 'POST' })
            .then((r) => r.json())
            .then((fresh) => {
              if (fresh?.token && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ event: 'auth', args: [fresh.token as string] }));
              }
            })
            .catch(() => undefined);
          break;
        }
        default:
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setConnected(false);
      if (unmounted.current || manualClose.current) return;
      reconnectAttempt.current += 1;
      const delay = Math.min(1500 * reconnectAttempt.current, 12_000);
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose menindaklanjuti
    };
  }, [enabled, serverId]);

  useEffect(() => {
    unmounted.current = false;
    connect();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        disconnect();
      } else if (!unmounted.current && !wsRef.current) {
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unmounted.current = true;
      document.removeEventListener('visibilitychange', onVisibility);
      disconnect();
    };
  }, [connect, disconnect]);

  return { samples, state, connected, error };
}
