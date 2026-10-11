/** Bar progres bertipe persentase. Warna = accent tema aktif. */
export function ProgressBar({
  value,
  label,
  className = '',
}: {
  /** 0–100. Nilai di luar rentang akan di-clamp. */
  value: number;
  label?: string;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div className={className}>
      {label && (
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-muted">
          <span>{label}</span>
          <span className="font-mono text-accent">{pct}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-base-700"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
