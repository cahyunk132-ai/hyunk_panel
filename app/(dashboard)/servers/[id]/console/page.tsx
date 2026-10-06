import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { Console } from '@/components/console/Console';
import { ConsoleResourceBar } from '@/components/console/ConsoleResourceBar';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Console' };

export default async function ConsolePage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const result = await checkPermission(user, 'console', params.id);
  if (result instanceof Response) notFound();
  const server = result.server;

  return (
    <div className="flex h-full min-h-[360px] flex-col gap-3 md:min-h-[420px]">
      <ConsoleResourceBar
        serverId={server.id}
        cpuLimit={server.cpu_limit}
        diskMb={server.disk_mb}
      />
      <div className="min-h-[280px] flex-1 md:min-h-[360px]">
        <Console serverId={server.id} />
      </div>
    </div>
  );
}
