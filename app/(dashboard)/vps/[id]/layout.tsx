import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { canManageVps, getVpsForUser } from '@/lib/vps/access';
import { Badge } from '@/components/ui/Badge';
import { VpsTabs } from '@/components/vps/VpsTabs';

export const dynamic = 'force-dynamic';

export default async function VpsDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const vps = await getVpsForUser(params.id, user);
  if (!vps) notFound();

  const manageable = canManageVps(user, vps);
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/vps" className="text-ink-faint transition-colors hover:text-ink" aria-label="Kembali ke VPS">←</Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{vps.name}</h1>
          <p className="mt-0.5 truncate font-mono text-xs text-ink-muted">{vps.host}:{vps.port} · {vps.username}</p>
        </div>
        <Badge tone={manageable ? 'accent' : 'gray'}>{manageable ? 'manage access' : 'read-only access'}</Badge>
      </div>
      <VpsTabs vpsId={vps.id} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
