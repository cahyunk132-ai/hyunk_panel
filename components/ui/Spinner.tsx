export function Spinner({
  size = 'md',
  className = '',
  tone = 'accent',
  label,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** `accent` = warna aksen tema; `inherit` = ikut warna teks induk (cocok di dalam tombol/badge). */
  tone?: 'accent' | 'inherit';
  /** Isi bila spinner berdiri sendiri (dibaca screen reader). Kosong = dekoratif. */
  label?: string;
}) {
  // Ukuran dari `size` hanya dipakai bila caller tidak mengatur tinggi sendiri lewat className.
  const sizeClass = /(^|\s)h-\d/.test(className)
    ? ''
    : size === 'sm'
      ? 'h-4 w-4'
      : size === 'lg'
        ? 'h-8 w-8'
        : 'h-6 w-6';
  const color = tone === 'accent' ? 'text-accent' : 'text-current';
  return (
    <svg
      className={`animate-spin ${color} ${sizeClass} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

export function PageLoader({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-3 text-ink-muted" aria-busy="true">
      <Spinner size="lg" label={label} />
      <span className="text-sm">{label}</span>
    </div>
  );
}
