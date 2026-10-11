'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { AnnouncementBanners } from '@/components/announcements/AnnouncementBanners';
import { toast } from '@/lib/utils/toast';
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

  // Selesai verifikasi email (/auth/callback → /dashboard?verified=1).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('verified') !== '1') return;
    toast.success('Email terverifikasi. Selamat datang di Hyunk Panel!');
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      // diabaikan — sekadar membersihkan query string
    }
  }, []);

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
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* Banner pengumuman admin — hanya di path ANNOUNCEMENT_BANNER_PATHS. */}
          <AnnouncementBanners />
          {children}
        </main>
      </div>
    </div>
  );
}
