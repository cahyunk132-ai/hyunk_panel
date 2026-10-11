import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getServerByIdOrUuid, hasPermission } from '@/lib/auth/rbac';
import { canManageSubdomainSafe } from '@/lib/subdomains/access';
import { SubdomainManager } from '@/components/servers/SubdomainManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Server Network' };

/**
 * /servers/{id}/network — Subdomain Manager.
 * Subdomain aktif + form daftar subdomain baru yang diarahkan reverse proxy
 * Wings ke IP:port server ini. Kelola: pemilik server (semua role, kuota
 * 2 subdomain/user untuk moderator/user/subuser) atau Owner Panel/Admin (tanpa batas).
 */
export default async function NetworkPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();
  const canRead = await hasPermission(user, 'server.read', server.id);
  if (!canRead) notFound();

  // Aturan yang SAMA dengan POST/DELETE /api/servers/{id}/subdomain
  // (owner server, anggota via `server_users`, atau Owner Panel/Admin).
  // Pakai salinan lokal = UI dan API bisa beda, dan buyer kehilangan tombol
  // atau malah dapat 403.
  const canManage = await canManageSubdomainSafe(user, server);

  return <SubdomainManager serverId={server.id} canManage={canManage} />;
}
