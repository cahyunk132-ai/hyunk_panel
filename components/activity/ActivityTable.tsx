import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';

export interface ActivityItem {
  id: string;
  action: string;
  created_at: string;
  ip: string | null;
  metadata: Record<string, unknown>;
  username: string | null;
  server_id: string | null;
  server_name: string | null;
}

function summarize(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof metadata.command === 'string') parts.push(`"${metadata.command.slice(0, 60)}"`);
  if (typeof metadata.file === 'string') parts.push(metadata.file);
  if (Array.isArray(metadata.fields)) parts.push(`ubah: ${(metadata.fields as string[]).join(', ')}`);
  if (typeof metadata.backup_uuid === 'string') parts.push(`backup ${String(metadata.backup_uuid).slice(0, 8)}…`);
  if (typeof metadata.successful === 'boolean') parts.push(metadata.successful ? 'sukses' : 'gagal');
  return parts.join(' · ');
}

/** Aksi panel (oleh user) ditandai aksen; aksi dari wings ditandai polos. */
export function ActivityTable({ items }: { items: ActivityItem[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-base-850">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-line-soft text-left text-[11px] uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2.5">Waktu</th>
            <th className="px-4 py-2.5">User</th>
            <th className="px-4 py-2.5">Aksi</th>
            <th className="px-4 py-2.5">Server</th>
            <th className="hidden px-4 py-2.5 lg:table-cell">Detail</th>
            <th className="hidden px-4 py-2.5 md:table-cell">IP</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-faint">
                Tidak ada log yang cocok.
              </td>
            </tr>
          )}
          {items.map((item) => {
            const fromWings = item.action.startsWith('wings:');
            return (
              <tr key={item.id} className="border-b border-line-soft/60 last:border-0 hover:bg-base-800/50">
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-ink-muted">
                  {new Date(item.created_at).toLocaleString('id-ID', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {item.username ?? <span className="text-ink-faint">{fromWings ? 'wings' : 'system'}</span>}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={fromWings ? 'gray' : 'accent'}>{item.action}</Badge>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {item.server_id ? (
                    <Link href={`/servers/${item.server_id}`} className="text-ink hover:text-accent">
                      {item.server_name ?? item.server_id.slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
                <td className="hidden max-w-[260px] truncate px-4 py-2.5 font-mono text-[11px] text-ink-muted lg:table-cell" title={summarize(item.metadata)}>
                  {summarize(item.metadata) || '—'}
                </td>
                <td className="hidden px-4 py-2.5 font-mono text-[11px] text-ink-faint md:table-cell">
                  {item.ip ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
