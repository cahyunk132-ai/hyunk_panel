import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isSupabaseServerConfigured } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { SetupScreen } from '@/components/SetupScreen';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseServerConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <SetupScreen />
      </div>
    );
  }

  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar isAdmin={user.role === 'admin'} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar username={user.username} email={user.email} role={user.role} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
