import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isSupabaseServerConfigured } from '@/lib/supabase/server';
import { DashboardShell } from '@/components/layout/DashboardShell';
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
    <DashboardShell username={user.username} email={user.email ?? ''} role={user.role}>
      {children}
    </DashboardShell>
  );
}
