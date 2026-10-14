'use client';

import { useEffect, useState } from 'react';

interface VpsStatsData {
  cpu: number;
  ram: { used: number; total: number };
  disk: { used: string; total: string; percent: string };
}

function toneFor(value: number): { bar: string; text: string } {
  if (value > 80) return { bar: 'bg-red-400', text: 'text-red-400' };
  if (value >= 60) return { bar: 'bg-amber-400', text: 'text-amber-400' };
  return { bar: 'bg-emerald-400', text: 'text-emerald-400' };
}

function Metric({ label, value, detail, percentage }: {
  label: string;
  value: number;
  detail: string;
  percentage: string;
}) {
  const tone = toneFor(value);
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px]">
        <span className="text-ink-faint">{label}</span>
        <span className={`font-mono ${tone.text}`}>{percentage}</span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        className="h-1.5 overflow-hidden rounded-full bg-base-700"
      >
        <div
          className={`h-full rounded-full transition-[width,background-color] duration-300 ${tone.bar}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <p className="mt-1 truncate font-mono text-[10px] text-ink-muted">{detail}</p>
    </div>
  );
}

export function VpsStats({ vpsId }: { vpsId: string }) {
  const [stats, setStats] = useState<VpsStatsData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      try {
        const response = await fetch(`/api/vps/${encodeURIComponent(vpsId)}/stats`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => ({}))) as Partial<VpsStatsData>;
        if (!response.ok || typeof body.cpu !== 'number' || !body.ram || !body.disk) throw new Error('stats unavailable');
        if (!active) return;
        setStats(body as VpsStatsData);
        setError(false);
      } catch {
        if (active && !controller.signal.aborted) {
          setStats(null);
          setError(true);
        }
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [vpsId]);

  if (error && !stats) {
    return (
      <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
        Tidak dapat terhubung
      </div>
    );
  }

  if (!stats) {
    return <p className="mt-4 text-[11px] text-ink-faint">Memuat statistik VPS…</p>;
  }

  const ramPercent = stats.ram.total > 0 ? (stats.ram.used / stats.ram.total) * 100 : 0;
  const diskPercent = Number.parseFloat(stats.disk.percent) || 0;

  return (
    <div className="mt-4 space-y-3 border-t border-line-soft pt-3">
      <Metric
        label="CPU"
        value={stats.cpu}
        percentage={`${stats.cpu.toFixed(1)}%`}
        detail={`${stats.cpu.toFixed(1)}% used`}
      />
      <Metric
        label="RAM"
        value={ramPercent}
        percentage={`${Math.round(ramPercent)}%`}
        detail={`${stats.ram.used} / ${stats.ram.total} MB`}
      />
      <Metric
        label="Disk"
        value={diskPercent}
        percentage={stats.disk.percent}
        detail={`${stats.disk.used} / ${stats.disk.total}`}
      />
    </div>
  );
}
