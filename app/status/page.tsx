import { PublicStatusPage } from '@/components/status/PublicStatusPage';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'System Status — HYUNK PANEL',
  description: 'Uptime dan status node Wings HYUNK PANEL.',
};

/** Public route; middleware intentionally allows /status without authentication. */
export default function StatusPage() {
  return <PublicStatusPage />;
}
