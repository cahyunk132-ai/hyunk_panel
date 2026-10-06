import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getEffectivePermissions, getServerByIdOrUuid, permissionsInclude } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { SftpDetails } from '@/components/servers/SftpDetails';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Akses SFTP' };

export default async function SftpPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();
  const perms = await getEffectivePermissions(user, server);
  if (perms.length === 0) notFound(); // 404 — jangan bocorkan eksistensi server

  const service = getSupabaseServiceClient();
  const { data: node } = await service
    .from('nodes')
    .select('fqdn')
    .eq('id', server.node_id)
    .maybeSingle();

  const hasFileAccess =
    permissionsInclude(perms, 'files.edit') ||
    permissionsInclude(perms, 'files.read') ||
    perms.includes('*');

  return (
    <SftpDetails
      serverUuid={server.uuid}
      nodeFqdn={(node?.fqdn as string | undefined) ?? ''}
      username={user.username}
      hasFileAccess={hasFileAccess}
    />
  );
}
