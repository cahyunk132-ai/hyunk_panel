import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { Console } from '@/components/console/Console';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Console' };

export default async function ConsolePage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const result = await checkPermission(user, 'console', params.id);
  if (result instanceof Response) notFound();

  return (
    <div className="h-full min-h-[420px]">
      <Console serverId={result.server.id} />
    </div>
  );
}
