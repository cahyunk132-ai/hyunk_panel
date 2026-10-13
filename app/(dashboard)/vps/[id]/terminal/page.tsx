import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getVpsForUser } from '@/lib/vps/access';
import { VpsTerminal } from '@/components/terminal/VpsTerminal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'VPS Terminal' };

export default async function VpsTerminalPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const vps = await getVpsForUser(params.id, user);
  if (!vps) notFound();

  return (
    <div className="flex h-full min-h-[600px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/vps" className="text-ink-faint transition-colors hover:text-ink" aria-label="Kembali ke VPS">
          ←
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold">{vps.name} · Terminal</h1>
          <p className="mt-0.5 truncate font-mono text-xs text-ink-muted">
            {vps.host}:{vps.port} · {vps.username}
          </p>
        </div>
      </div>

      <VpsTerminal
        vps={{
          id: vps.id,
          name: vps.name,
          host: vps.host,
          port: vps.port,
        }}
      />
    </div>
  );
}
