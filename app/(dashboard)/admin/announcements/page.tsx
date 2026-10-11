import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { AnnouncementsAdmin } from '@/components/admin/AnnouncementsAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Announcements' };

/**
 * /admin/announcements — broadcast pengumuman ke semua user panel.
 * Akses: Owner Panel & Admin saja. Data dikelola lewat
 * GET/POST /api/admin/announcements dan PATCH/DELETE /api/admin/announcements/{id}.
 */
export default async function AdminAnnouncementsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isPanelAdmin(user.role)) redirect('/dashboard');

  return <AnnouncementsAdmin />;
}
