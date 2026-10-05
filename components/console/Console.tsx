'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useWingsConsole } from '@/hooks/useWingsConsole';
import { StatusDot } from '@/components/servers/StatusBadge';
import { formatBytes, formatUptime } from '@/lib/utils/format';

// ─── Renderer ANSI sederhana (cukup untuk log Minecraft/daemon) ─────────────

const ANSI_COLORS: Record<number, string> = {
  30: '#4b5563',
  31: '#f87171',
  32: '#34d399',
  33: '#fbbf24',
  34: '#60a5fa',
  35: '#c084fc',
  36: '#22d3ee',
  37: '#e5e7eb',
  90: '#6b7280',
  91: '#fca5a5',
  92: '#6ee7b7',
  93: '#fde68a',
  94: '#93c5fd',
  95: '#d8b4fe',
  96: '#67e8f9',
  97: '#f9fafb',
};

interface Span {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

function parseAnsi(line: string): Span[] {
  const spans: Span[] = [];
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let color: string | undefined;
  let bold = false;
  let dim = false;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: line.slice(lastIndex, match.index), color, bold, dim });
    }
    const codes = match[1].split(';').map((c) => parseInt(c, 10));
    for (const code of codes) {
      if (code === 0) {
        color = undefined;
        bold = false;
        dim = false;
      } else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (ANSI_COLORS[code]) color = ANSI_COLORS[code];
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < line.length) {
    spans.push({ text: line.slice(lastIndex), color, bold, dim });
  }
  return spans.length > 0 ? spans : [{ text: line }];
}

// ─── Komponen utama ─────────────────────────────────────────────────────────

export function Console({ serverId }: { serverId: string }) {
  const { lines, status, stats, connectionState, connectionError, sendCommand, sendPowerState, clearLines } =
    useWingsConsole(serverId);
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, follow]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setFollow(atBottom);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd) return;
    if (cmd === '/start' || cmd === '/stop' || cmd === '/restart' || cmd === '/kill') {
      sendPowerState(cmd.slice(1) as 'start' | 'stop' | 'restart' | 'kill');
    } else {
      sendCommand(cmd);
    }
    setHistory((h) => [cmd, ...h.slice(0, 49)]);
    setHistoryIdx(-1);
    setCommand('');
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(historyIdx + 1, history.length - 1);
      if (history[next]) {
        setHistoryIdx(next);
        setCommand(history[next]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = historyIdx - 1;
      setHistoryIdx(next);
      setCommand(next >= 0 ? (history[next] ?? '') : '');
    }
  }

  const connLabel =
    connectionState === 'connected'
      ? 'Terhubung'
      : connectionState === 'connecting'
        ? 'Menghubungkan…'
        : 'Terputus';

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-base-950">
      {/* Bar status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft bg-base-850 px-4 py-2.5">
        <div className="flex items-center gap-3 text-xs">
          <StatusDot status={status} />
          <span className="font-medium text-ink">{status}</span>
          <span className="text-ink-faint">·</span>
          <span
            className={`flex items-center gap-1.5 ${
              connectionState === 'connected' ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                connectionState === 'connected' ? 'bg-emerald-400' : 'bg-amber-400 dot-pulse'
              }`}
            />
            {connLabel}
          </span>
          {connectionError && <span className="text-red-400">{connectionError}</span>}
        </div>
        <div className="flex items-center gap-4 font-mono text-[11px] text-ink-muted">
          {stats && (
            <>
              <span title="CPU">CPU {stats.cpu_absolute.toFixed(0)}%</span>
              <span title="Memory">
                RAM {formatBytes(stats.memory_bytes)}
                {stats.memory_limit_bytes > 0 && ` / ${formatBytes(stats.memory_limit_bytes)}`}
              </span>
              <span title="Uptime">UP {formatUptime(stats.uptime)}</span>
              <span title="Network">
                ▲{formatBytes(stats.network.tx_bytes)} ▼{formatBytes(stats.network.rx_bytes)}
              </span>
            </>
          )}
          <button
            onClick={clearLines}
            className="rounded border border-line px-2 py-0.5 text-ink-faint transition-colors hover:text-ink"
          >
            Bersihkan
          </button>
        </div>
      </div>

      {/* Output */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={() => inputRef.current?.focus()}
        className="hyunk-console console-scroll flex-1 overflow-y-auto bg-base-950 px-3 py-2"
      >
        {lines.length === 0 && (
          <p className="text-ink-faint">
            {connectionState === 'connected'
              ? 'Menunggu output…'
              : 'Menghubungkan ke node…'}
          </p>
        )}
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all text-ink/90">
            {parseAnsi(line).map((span, j) => (
              <span
                key={j}
                style={{ color: span.color }}
                className={`${span.bold ? 'ansi-bold' : ''} ${span.dim ? 'opacity-60' : ''}`}
              >
                {span.text}
              </span>
            ))}
          </div>
        ))}
      </div>

      {/* Input command */}
      <form onSubmit={submit} className="flex items-center gap-2 border-t border-line-soft bg-base-850 px-3 py-2.5">
        <span className="font-mono text-xs text-accent">❯</span>
        <input
          ref={inputRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ketik command server… ( /start /stop /restart /kill )"
          className="flex-1 bg-transparent font-mono text-xs text-ink placeholder:text-ink-faint outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className="rounded-md border border-line px-3 py-1 text-xs text-ink-muted transition-colors hover:border-accent/40 hover:text-accent"
        >
          Kirim
        </button>
      </form>
    </div>
  );
}
