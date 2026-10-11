import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { SubdomainsAdmin } from '@/components/admin/SubdomainsAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Subdomain Manager' };

/**
 * /admin/subdomains — semua subdomain yang terdaftar di panel.
 * Akses: Owner Panel & Admin saja. Data diambil client-side lewat
 * GET /api/admin/subdomains (service role, bypass RLS).
 */
export default async function AdminSubdomainsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/dashboard');

  return <SubdomainsAdmin />;
}
