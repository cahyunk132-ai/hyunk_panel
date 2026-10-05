'use client';

import { useId, useMemo } from 'react';

/**
 * Sparkline SVG murni (tanpa dependency) untuk resource monitoring.
 * Data: array angka (sampel terbaru di ujung kanan).
 */
export function Sparkline({
  data,
  domainMax,
  height = 72,
  stroke = '#3ecfcf',
  label,
  formatValue,
  caption,
}: {
  data: number[];
  /** Batas atas sumbu Y; jika tidak diisi memakai max data * 1.15 */
  domainMax?: number;
  height?: number;
  stroke?: string;
  label: string;
  formatValue: (v: number) => string;
  caption?: string;
}) {
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const W = 320;
  const H = 80;
  const PAD = 2;

  const { path, area, max, avg, current } = useMemo(() => {
    if (data.length === 0) {
      return { path: '', area: '', max: 0, avg: 0, current: 0 };
    }
    const rawMax = domainMax ?? Math.max(...data, 1) * 1.15;
    const top = rawMax <= 0 ? 1 : rawMax;
    const stepX = data.length > 1 ? (W - PAD * 2) / (data.length - 1) : 0;
    const pts = data.map((v, i) => {
      const x = PAD + i * stepX;
      const y = H - PAD - (Math.min(Math.max(v, 0), top) / top) * (H - PAD * 2 - 14);
      return [x, y] as const;
    });
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const areaPath =
      pts.length > 0
        ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - PAD} L${pts[0][0].toFixed(1)},${H - PAD} Z`
        : '';
    const sum = data.reduce((a, b) => a + b, 0);
    return {
      path: line,
      area: areaPath,
      max: Math.max(...data),
      avg: sum / data.length,
      current: data[data.length - 1] ?? 0,
    };
  }, [data, domainMax, W, H, PAD]);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
        <p className="font-mono text-sm font-semibold text-ink">{formatValue(current)}</p>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={label}
      >
        <defs>
          <linearGradient id={`g-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="#232a3a"
            strokeWidth="0.5"
            strokeDasharray="3 4"
          />
        ))}
        {data.length < 2 ? (
          <text x={W / 2} y={H / 2} textAnchor="middle" fill="#5d6679" fontSize="11">
            mengumpulkan sampel…
          </text>
        ) : (
          <>
            <path d={area} fill={`url(#g-${gradientId})`} />
            <path d={path} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
          </>
        )}
      </svg>

      <div className="flex items-center justify-between font-mono text-[10px] text-ink-faint">
        <span>avg {formatValue(avg)}</span>
        {caption && <span>{caption}</span>}
        <span>max {formatValue(max)}</span>
      </div>
    </div>
  );
}
