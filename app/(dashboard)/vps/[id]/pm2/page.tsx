import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { canManageVps, getVpsForUser } from '@/lib/vps/access';
import { Pm2Manager } from '@/components/vps/Pm2Manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'VPS PM2 Manager' };

export default async function VpsPm2Page({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const vps = await getVpsForUser(params.id, user);
  if (!vps) notFound();
  return <Pm2Manager vpsId={vps.id} canManage={canManageVps(user, vps)} />;
}
