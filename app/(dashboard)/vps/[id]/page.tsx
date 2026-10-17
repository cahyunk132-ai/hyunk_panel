import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getVpsForUser } from '@/lib/vps/access';
import { Card, CardHeader } from '@/components/ui/Card';
import { VpsStats } from '@/components/vps/VpsStats';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'VPS Overview' };

export default async function VpsOverviewPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const vps = await getVpsForUser(params.id, user);
  if (!vps) notFound();

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader title="Overview" subtitle="Informasi koneksi dan resource VPS." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div><p className="text-xs text-ink-faint">Host</p><p className="mt-1 font-mono text-sm text-ink">{vps.host}</p></div>
          <div><p className="text-xs text-ink-faint">SSH port</p><p className="mt-1 font-mono text-sm text-ink">{vps.port}</p></div>
          <div><p className="text-xs text-ink-faint">Username</p><p className="mt-1 font-mono text-sm text-ink">{vps.username}</p></div>
          <div><p className="text-xs text-ink-faint">Credential</p><p className="mt-1 text-sm text-emerald-400">Tersimpan terenkripsi</p></div>
        </div>
        <div className="border-t border-line-soft px-5 py-4 text-xs text-ink-muted">
          Credential SSH hanya didecrypt di server saat operasi SSH. Tidak ada credential yang dikirim ke browser.
        </div>
      </Card>
      <Card>
        <CardHeader title="Live resources" subtitle="Polling 10 detik" />
        <div className="p-5"><VpsStats vpsId={vps.id} /></div>
      </Card>
    </div>
  );
}
