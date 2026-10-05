'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WingsStatsPayload } from '@/lib/wings/types';

const MAX_LINES = 500;
const MAX_RECONNECT_DELAY = 15_000;

export type ConsoleConnectionState = 'connecting' | 'connected' | 'disconnected';

interface ConsoleTokenResponse {
  token: string;
  socket: string;
  expires_in: number;
}

/**
 * Hook console realtime — WebSocket langsung browser → Wings memakai JWT
 * sementara (diterbitkan API panel). Token node tidak pernah lewat sini.
 *
 * Protokol (wings router/websocket):
 *   kirim : { event: 'auth', args: [jwt] }
 *   kirim : { event: 'send logs' } / 'send stats' / 'send command' args[cmd] / 'set state' args[state]
 *   terima: 'auth success' | 'console output' | 'daemon message' | 'daemon error'
 *           | 'status' | 'stats' | 'token expiring' | 'jwt error' | 'install output'
 */
export function useWingsConsole(serverId: string, enabled = true) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<string>('offline');
  const [stats, setStats] = useState<WingsStatsPayload | null>(null);
  const [connectionState, setConnectionState] = useState<ConsoleConnectionState>('disconnected');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);
  const manualClose = useRef(false);

  const appendLine = useCallback((line: string) => {
    setLines((prev) => {
      const next = [...prev, line];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  const fetchToken = useCallback(async (): Promise<ConsoleTokenResponse> => {
    const res = await fetch(`/api/servers/${serverId}/console/token`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Gagal mengambil token console (${res.status})`);
    return json as ConsoleTokenResponse;
  }, [serverId]);

  const sendEvent = useCallback((event: string, ...args: string[]) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(args.length > 0 ? { event, args } : { event }));
    }
  }, []);

  const connect = useCallback(async () => {
    if (!enabled || unmounted.current) return;
    setConnectionState('connecting');
    manualClose.current = false;

    let socket: string;
    let token: string;
    try {
      ({ socket, token } = await fetchToken());
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Token error');
      setConnectionState('disconnected');
      reconnectTimer.current = setTimeout(connect, 5000);
      return;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(socket);
    } catch {
      setConnectionError('URL WebSocket tidak valid');
      setConnectionState('disconnected');
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ event: 'auth', args: [token] }));
    };

    ws.onmessage = async (ev) => {
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
          setConnectionState('connected');
          setConnectionError(null);
          sendEvent('send logs');
          sendEvent('send stats');
          break;
        case 'console output':
        case 'daemon message':
        case 'install output':
          (msg.args ?? []).forEach(appendLine);
          break;
        case 'daemon error':
          (msg.args ?? []).forEach((l) => appendLine(`\x1b[31m[daemon] ${l}\x1b[0m`));
          break;
        case 'status':
          if (msg.args?.[0]) setStatus(msg.args[0]);
          break;
        case 'stats':
          if (msg.args?.[0]) {
            try {
              setStats(JSON.parse(msg.args[0]) as WingsStatsPayload);
              const parsed = JSON.parse(msg.args[0]) as { state?: string };
              if (parsed.state) setStatus(parsed.state);
            } catch {
              // abaikan stat rusak
            }
          }
          break;
        case 'token expiring':
        case 'token expired':
          try {
            const fresh = await fetchToken();
            sendEvent('auth', fresh.token);
          } catch {
            appendLine('\x1b[33m[panel] gagal memperbarui token console\x1b[0m');
          }
          break;
        case 'jwt error':
          setConnectionError('Token console ditolak Wings (jwt error)');
          break;
        case 'deleted':
          appendLine('\x1b[31m[wings] server ini telah dihapus dari node\x1b[0m');
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (unmounted.current || manualClose.current) return;
      setConnectionState('disconnected');
      reconnectAttempt.current += 1;
      const delay = Math.min(1000 * 2 ** reconnectAttempt.current, MAX_RECONNECT_DELAY);
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose akan mengikuti — reconnect diatur di sana.
    };
  }, [enabled, fetchToken, appendLine, sendEvent]);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      manualClose.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const sendCommand = useCallback(
    (command: string) => {
      if (!command.trim()) return;
      appendLine(`\x1b[2m> ${command}\x1b[0m`);
      sendEvent('send command', command);
    },
    [appendLine, sendEvent],
  );

  const sendPowerState = useCallback(
    (state: 'start' | 'stop' | 'restart' | 'kill') => {
      sendEvent('set state', state);
    },
    [sendEvent],
  );

  const clearLines = useCallback(() => setLines([]), []);

  return {
    lines,
    status,
    stats,
    connectionState,
    connectionError,
    sendCommand,
    sendPowerState,
    clearLines,
  };
}
