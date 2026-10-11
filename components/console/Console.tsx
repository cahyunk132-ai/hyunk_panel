'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useWingsConsole } from '@/hooks/useWingsConsole';
import { StatusDot } from '@/components/servers/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast, updateToast } from '@/lib/utils/toast';

/** Lebar baris placeholder saat console belum terhubung (kelas statis agar terdeteksi Tailwind). */
const PLACEHOLDER_WIDTHS = ['w-[72%]', 'w-[46%]', 'w-[84%]', 'w-[58%]', 'w-[34%]'];

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
  const {
    lines,
    needsEula,
    status,
    connectionState,
    connectionError,
    sendCommand,
    sendPowerState,
    clearLines,
  } = useWingsConsole(serverId);
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [follow, setFollow] = useState(true);
  const [eulaLoading, setEulaLoading] = useState(false);
  const [eulaError, setEulaError] = useState<string | null>(null);
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

  async function acceptEula() {
    setEulaLoading(true);
    setEulaError(null);
    const toastId = toast.loading('Menerima EULA dan menjalankan server…');
    try {
      const res = await fetch(`/api/servers/${serverId}/eula`, { method: 'POST' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        const message = `Gagal menerima EULA: ${j.error ?? res.status}`;
        setEulaError(message);
        updateToast(toastId, message, 'error');
      } else {
        updateToast(toastId, 'EULA diterima — server sedang dijalankan', 'success');
      }
    } catch (err) {
      const message = `Gagal menerima EULA: ${err instanceof Error ? err.message : 'Kesalahan jaringan'}`;
      setEulaError(message);
      updateToast(toastId, message, 'error');
    } finally {
      setEulaLoading(false);
    }
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

  // Dot status koneksi: hijau = terhubung, amber berdenyut = sedang menyambung, merah = terputus.
  const connDotClass =
    connectionState === 'connected'
      ? 'bg-emerald-400'
      : connectionState === 'connecting'
        ? 'bg-amber-400 animate-pulse motion-reduce:animate-none'
        : 'bg-red-400';
  const connTextClass =
    connectionState === 'connected'
      ? 'text-emerald-400'
      : connectionState === 'connecting'
        ? 'text-amber-400'
        : 'text-red-400';
  const isConnecting = connectionState !== 'connected' && lines.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-line bg-base-950">
      {/* Bar status */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft bg-base-850 px-4 py-2.5">
        <div className="flex items-center gap-3 text-xs">
          <StatusDot status={status} />
          <span className="font-medium text-ink">{status}</span>
          <span className="text-ink-faint">·</span>
          <span className={`flex items-center gap-1.5 ${connTextClass}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connDotClass}`} />
            {connLabel}
          </span>
          {connectionError && <span className="text-red-400">{connectionError}</span>}
        </div>
        <div className="flex items-center gap-4 font-mono text-[11px] text-ink-muted">
          {/* Stat resource pindah ke ConsoleResourceBar di atas terminal. */}
          <button
            onClick={clearLines}
            disabled={lines.length === 0}
            className="rounded border border-line px-2 py-0.5 text-ink-faint transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            Bersihkan
          </button>
        </div>
      </div>

      {needsEula && (
        <div
          role="alert"
          className="mx-3 mt-3 flex flex-col gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 md:flex-row md:items-center md:justify-between"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-yellow-200">
              ⚠ Server membutuhkan persetujuan EULA Minecraft
            </p>
            <p className="mt-1 text-xs text-yellow-200/70">
              Dengan menekan tombol di bawah, kamu menyetujui
              <br className="hidden md:block" /> Minecraft End User License Agreement dari Mojang/Microsoft.
            </p>
            <p className="mt-1 text-xs text-yellow-200/70">
              →{' '}
              <a
                href="https://aka.ms/MinecraftEULA"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-yellow-100"
              >
                https://aka.ms/MinecraftEULA
              </a>
            </p>
            {eulaError && <p className="mt-2 text-xs text-red-300">{eulaError}</p>}
          </div>
          <button
            type="button"
            onClick={() => void acceptEula()}
            disabled={eulaLoading}
            aria-busy={eulaLoading || undefined}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-yellow-500 px-4 py-1.5 text-xs font-medium text-black transition-colors hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {eulaLoading && <Spinner size="sm" tone="inherit" className="h-3.5 w-3.5" />}
            {eulaLoading ? 'Mengirim…' : 'Terima EULA & Restart'}
          </button>
        </div>
      )}

      {/* Output */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={() => inputRef.current?.focus()}
        className="hyunk-console console-scroll min-h-0 flex-1 overflow-y-auto bg-base-950 px-3 py-2"
      >
        {isConnecting && (
          <div role="status" aria-label="Menghubungkan ke node" className="space-y-2.5 py-1">
            <p className="text-ink-faint">Menghubungkan ke node…</p>
            {PLACEHOLDER_WIDTHS.map((width) => (
              <Skeleton key={width} className={`h-3 ${width}`} />
            ))}
          </div>
        )}
        {lines.length === 0 && connectionState === 'connected' && (
          <p className="text-ink-faint">Menunggu output…</p>
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
      <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-line-soft bg-base-850 px-3 py-2.5">
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
