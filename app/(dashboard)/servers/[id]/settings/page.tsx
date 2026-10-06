import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getEffectivePermissions, getServerByIdOrUuid, permissionsInclude } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { ServerSettings } from '@/components/servers/ServerSettings';
import type { AllocationRow } from '@/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Server Settings' };

export default async function SettingsPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();
  const perms = await getEffectivePermissions(user, server);
  if (!permissionsInclude(perms, 'settings')) notFound();

  const service = getSupabaseServiceClient();
  const { data: allocation } = server.allocation_id
    ? await service.from('allocations').select('ip, port').eq('id', server.allocation_id).maybeSingle()
    : { data: null };

  return (
    <ServerSettings
      server={server}
      isAdmin={user.role === 'admin'}
      primaryAllocation={allocation as Pick<AllocationRow, 'ip' | 'port'> | null}
    />
  );
}
