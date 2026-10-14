'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NodeStatus, PublicNodeStatus, PublicStatusOverall, PublicStatusResponse } from '@/types';

const statusMeta: Record<NodeStatus, { label: string; dot: string; box: string; badge: string }> = {
  online: {
    label: 'Online',
    dot: 'bg-emerald-400',
    box: 'bg-emerald-400',
    badge: 'border-emerald-400/30 text-emerald-300',
  },
  degraded: {
    label: 'Degraded',
    dot: 'bg-amber-400',
    box: 'bg-amber-400',
    badge: 'border-amber-400/30 text-amber-300',
  },
  offline: {
    label: 'Offline',
    dot: 'bg-red-500',
    box: 'bg-red-500',
    badge: 'border-red-500/30 text-red-300',
  },
};

function overallMeta(overall: PublicStatusOverall) {
  if (overall === 'operational') {
    return {
      label: '✅ Semua Sistem Operasional',
      description: 'Semua node Wings merespons normal.',
      classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    };
  }
  if (overall === 'major_outage') {
    return {
      label: '🔴 Gangguan Mayor',
      description: 'Semua node saat ini tidak dapat dihubungi.',
      classes: 'border-red-500/30 bg-red-500/10 text-red-300',
    };
  }
  return {
    label: '⚠️ Gangguan Sebagian',
    description: 'Sebagian node mengalami gangguan atau latency tinggi.',
    classes: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  };
}

function formatUpdated(value: string | null): string {
  if (!value) return 'Belum ada check';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

export function PublicStatusPage() {
  const [data, setData] = useState<PublicStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      const body = (await response.json()) as PublicStatusResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Status tidak tersedia');
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status tidak tersedia');
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const meta = overallMeta(data?.overall ?? 'operational');

  return (
    <main className="min-h-screen bg-[#0f131a] px-4 py-8 text-[#e8edf5] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <a href="https://panel.wangstore.web.id" className="flex items-center gap-2.5" aria-label="HYUNK PANEL">
            <svg className="h-9 w-9" viewBox="0 0 64 64" aria-hidden="true">
              <rect width="64" height="64" rx="14" fill="#171b26" />
              <path d="M18 16h7v12h14V16h7v32h-7V35H25v13h-7z" fill="#3ecfcf" />
            </svg>
            <div className="leading-tight">
              <p className="text-sm font-extrabold tracking-wide">HYUNK PANEL</p>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[#3ecfcf]">Public Status</p>
            </div>
          </a>
          <p className="text-xs text-[#8995aa]">wangstore.web.id</p>
        </header>

        <section className={`mt-10 rounded-2xl border px-5 py-6 sm:px-7 ${meta.classes}`}>
          <h1 className="text-xl font-bold sm:text-2xl">{meta.label}</h1>
          <p className="mt-2 text-sm opacity-80">{meta.description}</p>
          <p className="mt-5 text-xs opacity-70">Last updated: {formatUpdated(data?.last_updated ?? null)}</p>
        </section>

        {error && (
          <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="mt-8 space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Wings Nodes</h2>
              <p className="mt-1 text-sm text-[#8995aa]">Uptime dihitung dari health check 90 hari terakhir.</p>
            </div>
            {data && <span className="text-xs text-[#667188]">Auto-refresh 60 detik</span>}
          </div>

          {!data && !error && <LoadingCard />}
          {data?.nodes.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#30394a] px-5 py-10 text-center text-sm text-[#8995aa]">
              Belum ada node terdaftar.
            </div>
          )}
          {data?.nodes.map((node) => <NodeStatusCard key={node.id} node={node} />)}
        </section>

        <footer className="mt-12 border-t border-[#252d3b] pt-5 text-center text-xs text-[#667188]">
          <p>
            HYUNK PANEL ·{' '}
            <a className="text-[#3ecfcf] hover:underline" href="https://panel.wangstore.web.id">
              Buka panel
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}

function LoadingCard() {
  return <div className="h-48 animate-pulse rounded-xl border border-[#252d3b] bg-[#171d27]" />;
}

function NodeStatusCard({ node }: { node: PublicNodeStatus }) {
  const status = statusMeta[node.status];
  const uptimeWidth = `${Math.max(0, Math.min(100, node.uptime_90d))}%`;

  return (
    <article className="rounded-xl border border-[#252d3b] bg-[#171d27] p-5 shadow-[0_12px_30px_rgba(0,0,0,0.15)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 rounded-full ${status.dot}`} />
            <h3 className="font-semibold">{node.name}</h3>
          </div>
          <p className="mt-1 pl-5 text-xs text-[#8995aa]">📍 {node.location || 'Lokasi tidak diketahui'}</p>
        </div>
        <div className="text-right">
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${status.badge}`}>
            {status.label}
          </span>
          <p className="mt-2 text-xs text-[#8995aa]">
            Latency: <strong className="text-[#e8edf5]">{node.latency_ms == null ? '—' : `${node.latency_ms} ms`}</strong>
          </p>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#8995aa]">90 hari terakhir</span>
          <strong>{node.uptime_90d.toFixed(1)}% uptime</strong>
        </div>
        <div className="mt-2 grid grid-cols-[repeat(15,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(30,minmax(0,1fr))]" aria-label="Riwayat status 90 hari">
          {node.history.map((day, index) => (
            <span
              key={`${node.id}-${index}`}
              title={`Hari ${index + 1}: ${day ? statusMeta[day].label : 'Belum ada data'}`}
              className={`h-3 rounded-[2px] ${day ? statusMeta[day].box : 'bg-[#30394a]'}`}
            />
          ))}
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#30394a]">
          <div className="h-full rounded-full bg-emerald-400 transition-[width]" style={{ width: uptimeWidth }} />
        </div>
      </div>
    </article>
  );
}
