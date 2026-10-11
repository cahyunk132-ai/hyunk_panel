import { Skeleton, SkeletonRegion, SkeletonTableRows } from '@/components/ui/Skeleton';

/**
 * Skeleton area konten tab server (header & tab bar tetap dari layout).
 * Tampil saat berpindah tab (console, files, backups, dst.).
 */
export default function ServerSectionLoading() {
  return (
    <SkeletonRegion label="Memuat halaman server" className="space-y-4">
      <div className="rounded-xl border border-line bg-base-850 p-5">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="mt-2 h-3 w-72 max-w-full" />
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-base-850">
        <table className="w-full text-sm">
          <tbody>
            <SkeletonTableRows rows={5} cols={4} hideOnMobile={[1, 2]} />
          </tbody>
        </table>
      </div>
    </SkeletonRegion>
  );
}
