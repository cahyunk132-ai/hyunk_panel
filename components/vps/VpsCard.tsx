'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { VpsListItem } from '@/types';
import { VpsStats } from './VpsStats';

export function VpsCard({
  vps,
  canManage,
  onEdit,
  onDelete,
  deleting = false,
}: {
  vps: VpsListItem;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
}) {
  return (
    <Card className="flex h-full flex-col px-5 py-4 transition-colors hover:border-accent/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-ink">{vps.name}</h2>
          <p className="mt-1 truncate font-mono text-xs text-ink-muted">
            {vps.host}:{vps.port}
          </p>
        </div>
        <Badge tone={canManage ? 'accent' : 'gray'}>{canManage ? 'Milik Anda' : 'Dibagikan'}</Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
        <div>
          <p className="text-ink-faint">Username</p>
          <p className="mt-0.5 truncate font-mono font-medium text-ink">{vps.username}</p>
        </div>
        <div>
          <p className="text-ink-faint">Port</p>
          <p className="mt-0.5 font-mono font-medium text-ink">{vps.port}</p>
        </div>
      </div>

      <VpsStats vpsId={vps.id} />

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href={`/vps/${vps.id}/terminal`}
          className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-dim"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="m5 7 5 5-5 5M13 17h6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Terminal
        </Link>
        <Link
          href={`/vps/${vps.id}/files`}
          className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-base-700 px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:border-accent/40 hover:text-accent"
        >
          <span aria-hidden="true">📁</span>
          Files
        </Link>
        {canManage && (
          <>
            <Button type="button" size="sm" variant="secondary" onClick={onEdit}>
              Edit
            </Button>
            <Button type="button" size="sm" variant="danger" loading={deleting} onClick={onDelete}>
              Hapus
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
