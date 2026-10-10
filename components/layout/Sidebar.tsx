'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import type { UserRole } from '@/types';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Hanya Owner Panel & Admin (section panel management). */
  adminOnly?: boolean;
}

const iconProps = {
  className: 'h-[18px] w-[18px]',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
};

const NAV_ITEMS: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/servers',
    label: 'Servers',
    icon: (
      <svg {...iconProps}>
        <rect x="2" y="4" width="20" height="7" rx="2" />
        <rect x="2" y="13" width="20" height="7" rx="2" />
        <path d="M6 7.5h.01M6 16.5h.01" />
      </svg>
    ),
  },
  {
    href: '/storage',
    label: 'Storage',
    icon: (
      <svg {...iconProps}>
        <path d="M7 18a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18.3 10.6 3.75 3.75 0 0 1 17.75 18H7Z" />
      </svg>
    ),
  },
  {
    href: '/admin/eggs',
    label: 'Egg Manager',
    adminOnly: true,
    icon: (
      <svg {...iconProps}>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="m4.5 7.7 7.5 4.4 7.5-4.4M12 12.1V21" />
      </svg>
    ),
  },
  {
    href: '/admin/backups',
    label: 'Auto Backups',
    adminOnly: true,
    icon: (
      <svg {...iconProps}>
        <path d="M4 5h16v11H4z" />
        <path d="M4 9h16M8 3v4M16 3v4" />
        <path d="M9 14.5 11 16l4-4" />
      </svg>
    ),
  },
  {
    href: '/nodes',
    label: 'Nodes',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="5" r="2.5" />
        <circle cx="5" cy="19" r="2.5" />
        <circle cx="19" cy="19" r="2.5" />
        <path d="M12 7.5 6 16.7M12 7.5l6 9.2M7.5 19h9" />
      </svg>
    ),
  },
  {
    href: '/users',
    label: 'Users',
    icon: (
      <svg {...iconProps}>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
        <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 15.5c1.8.8 2.7 2.4 3 4.5" />
      </svg>
    ),
  },
  {
    href: '/activity',
    label: 'Audit Log',
    icon: (
      <svg {...iconProps}>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    ),
  },
];

export function Sidebar({
  role,
  username,
  isOpen,
  onClose,
}: {
  role: UserRole;
  username: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch('/api/auth/signout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-line-soft bg-base-950/95 shadow-2xl transition-transform duration-200 md:relative md:z-auto md:w-56 md:translate-x-0 md:bg-base-950/80 md:shadow-none ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex h-14 items-center gap-2.5 border-b border-line-soft px-5">
        <svg className="h-7 w-7" viewBox="0 0 64 64">
          <rect width="64" height="64" rx="14" fill="#171b26" />
          <path d="M18 16h7v12h14V16h7v32h-7V35H25v13h-7z" fill="#3ecfcf" />
        </svg>
        <div className="leading-tight">
          <p className="text-[13px] font-extrabold tracking-wide text-ink">HYUNK</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-accent">PANEL</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.filter((item) => {
          // Storage untuk semua role (connect storage = milik user sendiri).
          if (item.href === '/storage') return true;
          if (item.adminOnly) return role === 'owner_panel' || role === 'admin';
          if (role === 'owner_panel' || role === 'admin') return true;
          if (role === 'moderator') return ['/dashboard', '/servers', '/activity'].includes(item.href);
          return item.href === '/servers';
        }).map((item) => {
          const active =
            item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-accent-soft font-semibold text-accent'
                  : 'text-ink-muted hover:bg-base-800 hover:text-ink'
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line-soft px-5 py-4">
        <div className="mb-4 flex items-center justify-between gap-3 md:hidden">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-ink">{username}</p>
            <p className="text-[10px] text-ink-faint">Signed in</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          >
            {signingOut ? '…' : 'Logout'}
          </button>
        </div>
        <p className="text-[10px] leading-relaxed text-ink-faint">
          One Panel.
          <br />
          Every Node.
          <br />
          Every Server.
        </p>
      </div>
    </aside>
  );
}
