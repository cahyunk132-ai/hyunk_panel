'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/Badge';

export function Topbar({
  username,
  email,
  role,
  onMenuClick,
}: {
  username: string;
  email: string;
  role: string;
  onMenuClick: () => void;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      getSupabaseBrowserClient();
      await fetch('/api/auth/signout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line-soft bg-base-950/60 px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-base-800 hover:text-ink md:hidden"
          aria-label="Buka menu navigasi"
          title="Menu"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex items-center gap-2 md:hidden" aria-label="Hyunk Panel">
          <svg className="h-7 w-7" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="#171b26" />
            <path d="M18 16h7v12h14V16h7v32h-7V35H25v13h-7z" fill="#3ecfcf" />
          </svg>
          <div className="leading-tight">
            <p className="text-[12px] font-extrabold tracking-wide text-ink">HYUNK</p>
            <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-accent">PANEL</p>
          </div>
        </div>

        <div className="hidden items-center gap-2 text-xs text-ink-faint md:flex">
          <span>panel.wangstore.web.id</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="hidden text-right leading-tight md:block">
          <p className="text-sm font-medium text-ink">{username}</p>
          <p className="text-[11px] text-ink-faint">{email}</p>
        </div>
        <Badge tone={role === 'admin' ? 'accent' : 'default'}>{role}</Badge>
        <button
          onClick={signOut}
          disabled={signingOut}
          className="hidden rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50 md:inline-flex"
          title="Keluar"
        >
          {signingOut ? '…' : 'Logout'}
        </button>
      </div>
    </header>
  );
}
