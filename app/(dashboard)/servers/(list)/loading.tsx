import { ServerCardSkeleton, Skeleton, SkeletonRegion } from '@/components/ui/Skeleton';

/** Skeleton daftar server — tampil saat /servers sedang diambil dari database. */
export default function ServersLoading() {
  return (
    <SkeletonRegion label="Memuat daftar server" className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <ServerCardSkeleton key={i} />
        ))}
      </div>
    </SkeletonRegion>
  );
}
