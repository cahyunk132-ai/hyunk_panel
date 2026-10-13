import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { listVpsForUser } from '@/lib/vps/access';
import { VpsCard } from '@/components/vps/VpsCard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'VPS' };

export default async function VpsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const vpsList = await listVpsForUser(user);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">VPS</h1>
        <p className="mt-0.5 text-sm text-ink-muted">{vpsList.length} VPS yang dapat kamu akses</p>
      </div>

      {vpsList.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-base-850/50 px-6 py-14 text-center">
          <p className="text-sm text-ink-muted">Belum ada VPS yang tersedia.</p>
          <p className="mt-2 text-xs text-ink-faint">
            VPS akan muncul setelah akunmu ditambahkan sebagai pemilik atau anggota VPS.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vpsList.map((vps) => (
            <VpsCard key={vps.id} vps={vps} />
          ))}
        </div>
      )}
    </div>
  );
}
