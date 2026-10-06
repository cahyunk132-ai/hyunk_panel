'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function ServerTabs({ serverId }: { serverId: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/servers/${serverId}`, label: 'Overview' },
    { href: `/servers/${serverId}/console`, label: 'Console' },
    { href: `/servers/${serverId}/files`, label: 'Files' },
    { href: `/servers/${serverId}/sftp`, label: 'SFTP' },
    { href: `/servers/${serverId}/backups`, label: 'Backups' },
    { href: `/servers/${serverId}/activity`, label: 'Activity' },
    { href: `/servers/${serverId}/settings`, label: 'Settings' },
  ];

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line-soft">
      {tabs.map((tab) => {
        const active =
          tab.href === `/servers/${serverId}` ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors ${
              active
                ? 'border-accent font-medium text-accent'
                : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
