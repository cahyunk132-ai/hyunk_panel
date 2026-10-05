import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export interface NodeCardData {
  id: string;
  name: string;
  fqdn: string;
  location: string;
  is_maintenance: boolean;
  server_count?: number;
}

export function NodeCard({ node }: { node: NodeCardData }) {
  return (
    <Link href={`/nodes/${node.id}`}>
      <Card className="group h-full px-5 py-4 transition-colors hover:border-accent/30">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink group-hover:text-accent">{node.name}</h3>
            <p className="mt-0.5 font-mono text-[11px] text-ink-faint">{node.fqdn}</p>
          </div>
          {node.is_maintenance ? (
            <Badge tone="yellow">Maintenance</Badge>
          ) : (
            <Badge tone="green">Aktif</Badge>
          )}
        </div>
        <div className="mt-4 flex items-center gap-4 text-[11px] text-ink-muted">
          <span>📍 {node.location}</span>
          {typeof node.server_count === 'number' && <span>🖥 {node.server_count} server</span>}
        </div>
      </Card>
    </Link>
  );
}
