'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const tabs = [
  { label: 'Overview', href: '' },
  { label: 'Terminal', href: '/terminal' },
  { label: 'Files', href: '/files' },
  { label: 'PM2', href: '/pm2' },
  { label: 'Deploy', href: '/deploy' },
];

export function VpsTabs({ vpsId }: { vpsId: string }) {
  const pathname = usePathname();
  const base = `/vps/${encodeURIComponent(vpsId)}`;
  return (
    <nav className="flex min-w-0 gap-1 overflow-x-auto border-b border-line-soft" aria-label="VPS navigation">
      {tabs.map((tab) => {
        const href = `${base}${tab.href}`;
        const active = tab.href ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base || pathname === `${base}/`;
        return (
          <Link
            key={tab.label}
            href={href}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${active ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:border-line hover:text-ink'}`}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
