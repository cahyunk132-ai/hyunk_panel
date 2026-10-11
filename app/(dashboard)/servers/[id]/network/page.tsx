import { notFound, redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getServerByIdOrUuid, hasPermission } from '@/lib/auth/rbac';
import { hasServerAccessSafe } from '@/lib/subdomains/access';
import { SubdomainManager } from '@/components/servers/SubdomainManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Server Network' };

/**
 * /servers/{id}/network — Subdomain Manager.
 * Subdomain aktif + form daftar subdomain baru yang diarahkan reverse proxy
 * Wings ke IP:port server ini.
 *
 * Aturan: SATU subdomain aktif per server, tanpa kuota per user. Siapa pun yang
 * punya akses ke server ini (owner, anggota `server_users`, atau Owner
 * Panel/Admin) boleh daftar dan hapus — sama persis dengan aturan yang dipakai
 * POST/DELETE /api/servers/{id}/subdomain lewat `lib/subdomains/access`.
 * Pakai salinan lokal = UI dan API bisa beda, dan buyer kehilangan tombol atau
 * malah dapat 403.
 */
export default async function NetworkPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const server = await getServerByIdOrUuid(params.id);
  if (!server) notFound();
  const canRead = await hasPermission(user, 'server.read', server.id);
  if (!canRead) notFound();

  const canAccess = await hasServerAccessSafe(user, server);

  return <SubdomainManager serverId={server.id} canAccess={canAccess} />;
}
