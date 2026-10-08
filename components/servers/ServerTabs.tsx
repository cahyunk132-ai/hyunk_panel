'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function hasPermission(permissions: string[], needed: string): boolean {
  if (permissions.includes('*') || permissions.includes(needed)) return true;
  return (needed === 'files.read' || needed === 'files.edit') && permissions.includes('files');
}

export function ServerTabs({
  serverId,
  permissions,
  canViewActivity,
  showPlugins = false,
  showBedrockAddons = false,
}: {
  serverId: string;
  permissions: string[];
  canViewActivity: boolean;
  showPlugins?: boolean;
  showBedrockAddons?: boolean;
}) {
  const pathname = usePathname();
  const canReadFiles = hasPermission(permissions, 'files.read');
  const tabs = [
    { href: `/servers/${serverId}`, label: 'Overview' },
    ...(hasPermission(permissions, 'console')
      ? [{ href: `/servers/${serverId}/console`, label: 'Console' }]
      : []),
    ...(canReadFiles ? [{ href: `/servers/${serverId}/files`, label: 'Files' }] : []),
    ...(hasPermission(permissions, 'players')
      ? [{ href: `/servers/${serverId}/players`, label: 'Players' }]
      : []),
    ...(showPlugins && canReadFiles
      ? [{ href: `/servers/${serverId}/plugins`, label: 'Mods & Plugins' }]
      : []),
    ...(showBedrockAddons && canReadFiles
      ? [{ href: `/servers/${serverId}/addons`, label: 'Addons' }]
      : []),
    ...(canReadFiles ? [{ href: `/servers/${serverId}/sftp`, label: 'SFTP' }] : []),
    ...(hasPermission(permissions, 'backups')
      ? [{ href: `/servers/${serverId}/backups`, label: 'Backups' }]
      : []),
    ...(canViewActivity ? [{ href: `/servers/${serverId}/activity`, label: 'Activity' }] : []),
    { href: `/servers/${serverId}/settings`, label: 'Settings' },
  ];

  return (
    <nav className="flex flex-nowrap gap-1 overflow-x-auto border-b border-line-soft">
      {tabs.map((tab) => {
        const active =
          tab.href === `/servers/${serverId}` ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors ${
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
