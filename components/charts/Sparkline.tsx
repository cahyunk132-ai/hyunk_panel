'use client';

import { useId, useMemo } from 'react';

/**
 * Sparkline SVG murni (tanpa dependency) untuk resource monitoring.
 * Data: array angka (sampel terbaru di ujung kanan).
 */
export function Sparkline({
  data,
  data2,
  domainMax,
  height = 72,
  stroke = '#3ecfcf',
  stroke2 = '#f59e0b',
  label,
  formatValue,
  caption,
  headerRight,
  footer,
}: {
  data: number[];
  /** Seri kedua (opsional) — digambar di skala yang sama, mis. TX vs RX. */
  data2?: number[];
  /** Batas atas sumbu Y; jika tidak diisi memakai max data * 1.15 */
  domainMax?: number;
  height?: number;
  stroke?: string;
  stroke2?: string;
  label: string;
  formatValue: (v: number) => string;
  caption?: string;
  /** Override nilai di kanan header (default: formatValue(current)). */
  headerRight?: React.ReactNode;
  /** Override baris footer (default: avg · caption · max). */
  footer?: React.ReactNode;
}) {
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const W = 320;
  const H = 80;
  const PAD = 2;

  const { path, path2, area, max, avg, current } = useMemo(() => {
    const empty = { path: '', path2: '', area: '', max: 0, avg: 0, current: 0 };
    if (data.length === 0) return empty;
    const combined = data2 && data2.length > 0 ? [...data, ...data2] : data;
    const rawMax = domainMax ?? Math.max(...combined, 1) * 1.15;
    const top = rawMax <= 0 ? 1 : rawMax;
    const toPath = (series: number[]) => {
      const stepX = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0;
      const pts = series.map((v, i) => {
        const x = PAD + i * stepX;
        const y = H - PAD - (Math.min(Math.max(v, 0), top) / top) * (H - PAD * 2 - 14);
        return [x, y] as const;
      });
      return pts
        .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
        .join(' ');
    };
    const line = toPath(data);
    const line2 = data2 && data2.length > 0 ? toPath(data2) : '';
    const areaPath =
      line !== '' ? `${line} L${W - PAD},${H - PAD} L${PAD},${H - PAD} Z` : '';
    const sum = data.reduce((a, b) => a + b, 0);
    return {
      path: line,
      path2: line2,
      area: areaPath,
      max: Math.max(...data),
      avg: sum / data.length,
      current: data[data.length - 1] ?? 0,
    };
  }, [data, data2, domainMax, W, H, PAD]);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
        <div className="font-mono text-sm font-semibold text-ink">
          {headerRight ?? formatValue(current)}
        </div>
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
            {path2 !== '' && (
              <path d={path2} fill="none" stroke={stroke2} strokeWidth="1.6" strokeLinejoin="round" />
            )}
          </>
        )}
      </svg>

      <div className="flex items-center justify-between font-mono text-[10px] text-ink-faint">
        {footer ?? (
          <>
            <span>avg {formatValue(avg)}</span>
            {caption && <span>{caption}</span>}
            <span>max {formatValue(max)}</span>
          </>
        )}
      </div>
    </div>
  );
}
