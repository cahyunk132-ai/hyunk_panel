'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import type { UserRole } from '@/types';

export function DashboardShell({
  children,
  username,
  email,
  role,
}: {
  children: React.ReactNode;
  username: string;
  email: string;
  role: UserRole;
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        role={role}
        username={username}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[1px] md:hidden"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          username={username}
          email={email}
          role={role}
          onMenuClick={() => setSidebarOpen((open) => !open)}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
