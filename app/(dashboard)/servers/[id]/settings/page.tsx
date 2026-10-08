import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import {
  getEffectivePermissions,
  getServerByIdOrUuid,
  hasPermission,
  permissionsInclude,
} from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { ServerSettings } from '@/components/servers/ServerSettings';
import { SubuserManagement } from '@/components/servers/SubuserManagement';
import { StartupChanger } from '@/components/eggs/StartupChanger';
import { isPanelAdmin } from '@/lib/auth/roles';
import type { AllocationRow } from '@/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Server Settings' };

export default async function SettingsPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();
  if (!(await hasPermission(user, 'server.read', server.id))) notFound();
  const [perms, canManageSubusers] = await Promise.all([
    getEffectivePermissions(user, server),
    hasPermission(user, 'assign_subuser', server.id),
  ]);
  const canEditSettings = permissionsInclude(perms, 'settings');

  if (!canEditSettings) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Server settings</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Lihat Egg dan versi aktif server {server.name}.
          </p>
        </div>
        <StartupChanger serverId={server.id} />
        {canManageSubusers && <SubuserManagement serverId={server.id} />}
      </div>
    );
  }

  const service = getSupabaseServiceClient();
  const { data: allocation } = server.allocation_id
    ? await service.from('allocations').select('ip, port').eq('id', server.allocation_id).maybeSingle()
    : { data: null };

  return (
    <div className="space-y-4">
      <StartupChanger serverId={server.id} />
      <ServerSettings
        server={server}
        isAdmin={isPanelAdmin(user.role)}
        primaryAllocation={allocation as Pick<AllocationRow, 'ip' | 'port'> | null}
      />
      {canManageSubusers && <SubuserManagement serverId={server.id} />}
    </div>
  );
}
