import type { ReactNode } from 'react';

/**
 * Blok placeholder dasar. Dipakai untuk mengganti layar kosong saat data belum
 * termuat. Warna mengambil dari token tema (base-700) sehingga ikut appearance.
 * `motion-reduce` mematikan animasi pulse untuk pengguna yang minta reduced motion.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-base-700/70 motion-reduce:animate-none ${className}`} />;
}

/** Wrapper aksesibel: screen reader diberi tahu bahwa konten sedang dimuat. */
export function SkeletonRegion({
  label = 'Memuat…',
  className = '',
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

/** Satu baris tabel placeholder. `cols` menentukan jumlah sel. */
export function SkeletonTableRows({
  rows = 5,
  cols = 4,
  hideOnMobile = [],
}: {
  rows?: number;
  cols?: number;
  /** Indeks kolom yang disembunyikan di layar kecil (sesuai header tabel). */
  hideOnMobile?: number[];
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-line-soft/60 last:border-0">
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className={`px-3 py-3 ${hideOnMobile.includes(c) ? 'hidden md:table-cell' : ''}`}>
              <Skeleton className={`h-3.5 ${c === 0 ? 'w-3/4' : c === cols - 1 ? 'ml-auto w-16' : 'w-2/3'}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Kartu server placeholder — bentuk sama dengan ServerCard. */
export function ServerCardSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-base-850 px-5 py-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <Skeleton className="h-2.5 w-8" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-2.5 w-8" />
          <Skeleton className="h-3 w-10" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-2.5 w-8" />
          <Skeleton className="h-3 w-14" />
        </div>
      </div>
      <Skeleton className="mt-3 h-2.5 w-3/5" />
    </div>
  );
}

/** Kartu storage provider placeholder — bentuk sama dengan kartu di StorageManager. */
export function ProviderCardSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-base-850 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
        <Skeleton className="h-5 w-20 rounded-md" />
      </div>
      <div className="mt-3 flex gap-2">
        <Skeleton className="h-5 w-24 rounded-md" />
        <Skeleton className="h-5 w-16 rounded-md" />
      </div>
      <div className="mt-3 flex gap-2">
        <Skeleton className="h-7 w-14 rounded-md" />
        <Skeleton className="h-7 w-20 rounded-md" />
      </div>
    </div>
  );
}
