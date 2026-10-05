export function Spinner({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-6 w-6';
  return (
    <svg className={`animate-spin text-accent ${s} ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

export function PageLoader({ label = 'Memuat…' }: { label?: string }) {
  return (
    <div className="flex h-48 flex-col items-center justify-center gap-3 text-ink-muted">
      <Spinner size="lg" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
