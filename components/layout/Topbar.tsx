'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/Badge';

export function Topbar({ username, email, role }: { username: string; email: string; role: string }) {
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
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line-soft bg-base-950/60 px-6">
      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <span className="hidden sm:inline">panel.wangstore.web.id</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right leading-tight">
          <p className="text-sm font-medium text-ink">{username}</p>
          <p className="text-[11px] text-ink-faint">{email}</p>
        </div>
        <Badge tone={role === 'admin' ? 'accent' : 'default'}>{role}</Badge>
        <button
          onClick={signOut}
          disabled={signingOut}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          title="Keluar"
        >
          {signingOut ? '…' : 'Logout'}
        </button>
      </div>
    </header>
  );
}
