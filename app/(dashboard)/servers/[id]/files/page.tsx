import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getEffectivePermissions, getServerByIdOrUuid, permissionsInclude } from '@/lib/auth/rbac';
import { FileManager } from '@/components/files/FileManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'File Manager' };

export default async function FilesPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();
  const perms = await getEffectivePermissions(user, server);
  if (!permissionsInclude(perms, 'files.read')) notFound();

  return <FileManager serverId={server.id} canEdit={permissionsInclude(perms, 'files.edit')} />;
}
