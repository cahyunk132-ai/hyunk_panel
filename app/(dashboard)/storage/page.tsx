import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { StorageManager } from '@/components/storage/StorageManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Storage' };

export default async function StoragePage({
  searchParams,
}: {
  searchParams: { connected?: string; error?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <StorageManager
      initialConnected={searchParams.connected}
      initialError={searchParams.error}
    />
  );
}
