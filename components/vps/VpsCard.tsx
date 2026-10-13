import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import type { VpsListItem } from '@/lib/vps/access';

export function VpsCard({ vps }: { vps: VpsListItem }) {
  return (
    <Card className="flex h-full flex-col px-5 py-4 transition-colors hover:border-accent/30">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-ink">{vps.name}</h2>
        <p className="mt-1 truncate font-mono text-xs text-ink-muted">
          {vps.host}:{vps.port}
        </p>
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

      <Link
        href={`/vps/${vps.id}/terminal`}
        className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-dim"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m5 7 5 5-5 5M13 17h6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Terminal
      </Link>
    </Card>
  );
}
