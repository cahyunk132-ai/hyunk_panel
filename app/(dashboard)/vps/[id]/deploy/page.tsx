import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { canManageVps, getVpsForUser } from '@/lib/vps/access';
import { DeployManager } from '@/components/vps/DeployManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'VPS App Deploy' };

export default async function VpsDeployPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const vps = await getVpsForUser(params.id, user);
  if (!vps) notFound();
  return <DeployManager vpsId={vps.id} username={vps.username} canManage={canManageVps(user, vps)} />;
}
