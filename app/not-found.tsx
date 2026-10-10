import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base text-center">
      <p className="font-mono text-6xl font-bold text-accent">404</p>
      <p className="text-sm text-ink-muted">Halaman tidak ditemukan atau Anda tidak punya akses.</p>
      <Link
        href="/"
        className="rounded-lg border border-line bg-base-800 px-4 py-2 text-sm text-ink transition-colors hover:border-accent/40 hover:text-accent"
      >
        ← Back to Home
      </Link>
    </div>
  );
}
