'use client';

import '@xterm/xterm/css/xterm.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/lib/utils/toast';

const SESSION_WARNING_MS = 30 * 60 * 1000;

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface VpsTerminalProps {
  vps: {
    id: string;
    name: string;
    host: string;
    port: number;
  };
}

interface TokenResponse {
  token?: string;
  wsUrl?: string;
  expires_in?: number;
  error?: string;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function socketUrl(wsUrl: string, token: string): string {
  const separator = wsUrl.includes('?') ? '&' : '?';
  return `${wsUrl}${separator}token=${encodeURIComponent(token)}`;
}

export function VpsTerminal({ vps }: VpsTerminalProps) {
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef(0);
  const warningTimerRef = useRef<number | null>(null);
  const connectRef = useRef<() => Promise<void>>(async () => undefined);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [sessionWarning, setSessionWarning] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [extendLoading, setExtendLoading] = useState(false);

  const clearWarningTimer = useCallback(() => {
    if (warningTimerRef.current !== null) {
      window.clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
  }, []);

  const scheduleSessionWarning = useCallback(() => {
    clearWarningTimer();
    warningTimerRef.current = window.setTimeout(() => {
      setSessionWarning(true);
      toast.warning('Sesi terminal akan habis dalam 5 menit.');
    }, SESSION_WARNING_MS);
  }, [clearWarningTimer]);

  const sendMessage = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const sendResize = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    sendMessage({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
  }, [sendMessage]);

  const disconnect = useCallback(
    (showToast = false) => {
      connectionIdRef.current += 1;
      clearWarningTimer();
      setSessionWarning(false);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, 'Disconnected by user');
      setConnectionStatus('disconnected');
      if (showToast) toast.info('Terminal disconnected.');
    },
    [clearWarningTimer],
  );

  const connect = useCallback(async () => {
    const connectionId = connectionIdRef.current + 1;
    connectionIdRef.current = connectionId;
    clearWarningTimer();
    setConnectionStatus('connecting');
    setConnectionError(null);

    const previousSocket = socketRef.current;
    socketRef.current = null;
    if (previousSocket && previousSocket.readyState !== WebSocket.CLOSED) {
      previousSocket.close(1000, 'Opening a new session');
    }

    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vps.id)}/terminal-token`, {
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => ({}))) as TokenResponse;
      if (!response.ok || !body.token || !body.wsUrl) {
        throw new Error(body.error ?? 'Gagal mendapatkan token terminal');
      }
      if (connectionId !== connectionIdRef.current) return;

      const socket = new WebSocket(socketUrl(body.wsUrl, body.token));
      socketRef.current = socket;

      socket.onopen = () => {
        if (connectionId !== connectionIdRef.current) {
          socket.close(1000, 'Stale terminal session');
          return;
        }
        setConnectionStatus('connected');
        setConnectionError(null);
        setSessionExpired(false);
        setSessionWarning(false);
        scheduleSessionWarning();
        // Fit first so the service receives the current browser dimensions.
        try {
          fitAddonRef.current?.fit();
        } catch {
          // The terminal can be temporarily hidden during a layout transition.
        }
        sendResize();
      };

      socket.onmessage = (event) => {
        if (connectionId !== connectionIdRef.current) return;
        if (typeof event.data !== 'string') return;

        let message: { type?: string; data?: unknown; message?: unknown };
        try {
          message = JSON.parse(event.data) as typeof message;
        } catch {
          toast.error('Terminal mengirim pesan yang tidak valid.');
          return;
        }

        if (message.type === 'data' && typeof message.data === 'string') {
          try {
            terminalRef.current?.write(decodeBase64(message.data));
          } catch {
            toast.error('Output terminal tidak dapat didecode.');
          }
          return;
        }

        if (message.type === 'status' && message.message === 'connected') {
          setConnectionStatus('connected');
          return;
        }

        if (message.type === 'status' && message.message === 'disconnected') {
          clearWarningTimer();
          setSessionWarning(false);
          setConnectionStatus('disconnected');
          setConnectionError('Terminal terputus');
          return;
        }

        if (message.type === 'error') {
          const errorMessage = typeof message.message === 'string' ? message.message : 'Terminal error';
          setConnectionError(errorMessage);
          setConnectionStatus('disconnected');
          toast.error(errorMessage);
          if (errorMessage.toLowerCase() === 'session timeout') {
            clearWarningTimer();
            setSessionWarning(false);
            setSessionExpired(true);
          }
        }
      };

      socket.onerror = () => {
        if (connectionId !== connectionIdRef.current) return;
        setConnectionError('Gagal terhubung ke terminal service');
      };

      socket.onclose = () => {
        if (connectionId !== connectionIdRef.current) return;
        socketRef.current = null;
        clearWarningTimer();
        setConnectionStatus('disconnected');
      };
    } catch (error) {
      if (connectionId !== connectionIdRef.current) return;
      const message = error instanceof Error ? error.message : 'Gagal terhubung ke terminal';
      setConnectionStatus('disconnected');
      setConnectionError(message);
      toast.error(message);
    }
  }, [clearWarningTimer, scheduleSessionWarning, sendResize, vps.id]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: '#080a0f',
        foreground: '#e5e7eb',
        cursor: '#3ecfcf',
        selectionBackground: '#3ecfcf55',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const dataDisposable = terminal.onData((data) => {
      sendMessage({ type: 'data', data: encodeBase64(data) });
    });
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      sendMessage({ type: 'resize', cols, rows });
    });
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // Ignore measurements while the terminal container has no dimensions.
      }
    });
    observer.observe(container);

    try {
      fitAddon.fit();
    } catch {
      // A second fit happens on WebSocket open.
    }
    void connect();

    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      clearWarningTimer();
      connectionIdRef.current += 1;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000, 'Terminal page closed');
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [clearWarningTimer, connect, sendMessage]);

  function reconnect() {
    setSessionExpired(false);
    void connectRef.current();
  }

  async function extendSession() {
    setExtendLoading(true);
    try {
      await connectRef.current();
    } finally {
      setExtendLoading(false);
    }
  }

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';
  const statusLabel = isConnected ? 'Connected' : isConnecting ? 'Connecting…' : 'Disconnected';
  const statusColor = isConnected
    ? 'bg-emerald-400'
    : isConnecting
      ? 'bg-amber-400 animate-pulse motion-reduce:animate-none'
      : 'bg-red-400';
  const statusTextColor = isConnected
    ? 'text-emerald-400'
    : isConnecting
      ? 'text-amber-400'
      : 'text-red-400';

  return (
    <div className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-xl border border-line bg-base-950">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft bg-base-850 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold text-ink">{vps.name}</span>
            <span className="font-mono text-xs text-ink-muted">
              {vps.host}:{vps.port}
            </span>
            <span className={`inline-flex items-center gap-1.5 text-xs ${statusTextColor}`} aria-live="polite">
              <span className={`h-2 w-2 rounded-full ${statusColor}`} />
              {statusLabel}
            </span>
          </div>
          {connectionError && <p className="mt-1 text-xs text-red-400">{connectionError}</p>}
        </div>
        <div className="flex items-center gap-2">
          {!isConnected && !isConnecting && (
            <Button type="button" size="sm" variant="secondary" onClick={reconnect}>
              Reconnect
            </Button>
          )}
          {(isConnected || isConnecting) && (
            <Button type="button" size="sm" variant="danger" onClick={() => disconnect(true)}>
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {sessionWarning && (
        <div className="flex flex-col gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium text-amber-200">Sesi terminal akan habis dalam 5 menit.</p>
            <p className="mt-0.5 text-xs text-amber-200/70">Perpanjang sesi agar koneksi tetap aktif.</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={extendLoading}
            onClick={() => void extendSession()}
          >
            Perpanjang Sesi
          </Button>
        </div>
      )}

      <div ref={terminalContainerRef} className="hyunk-console min-h-0 flex-1 bg-[#080a0f] px-1 py-1" />

      <Modal open={sessionExpired} onClose={() => setSessionExpired(false)} title="Session habis">
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            Sesi terminal sudah berakhir. Hubungkan kembali untuk mendapatkan sesi baru.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setSessionExpired(false)}>
              Tutup
            </Button>
            <Button type="button" onClick={() => { setSessionExpired(false); reconnect(); }}>
              Reconnect
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
