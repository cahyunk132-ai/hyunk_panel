'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { PageLoader } from '@/components/ui/Spinner';
import { formatBytes, formatRelativeTime } from '@/lib/utils/format';
import type { BackupLogRow, BackupLogStatus } from '@/types';

type LogWithProvider = BackupLogRow & {
  provider_name: string | null;
  provider_type: string | null;
  download_url: string | null;
};

const STATUS_TONES: Record<BackupLogStatus, 'yellow' | 'green' | 'red'> = {
  pending: 'yellow',
  creating: 'yellow',
  uploading: 'yellow',
  done: 'green',
  failed: 'red',
};

const STATUS_LABELS: Record<BackupLogStatus, string> = {
  pending: 'Pending',
  creating: 'Creating…',
  uploading: 'Uploading…',
  done: 'Done',
  failed: 'Failed',
};

export function BackupHistory({ serverId }: { serverId: string }) {
  const [logs, setLogs] = useState<LogWithProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/backup-logs`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal memuat history');
      setLogs(json.logs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    load();
    // Ada log yang sedang berjalan → refresh berkala.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="rounded-xl border border-line bg-base-850 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Backup History</h3>
          <p className="text-xs text-ink-muted">Riwayat auto backup ke cloud storage.</p>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-4">
          <PageLoader label="Memuat history…" />
        </div>
      ) : logs.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-line bg-base-850/50 px-6 py-10 text-center text-sm text-ink-faint">
          Belum ada auto backup berjalan.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5">Waktu</th>
                <th className="px-4 py-2.5">File</th>
                <th className="w-28 px-4 py-2.5">Ukuran</th>
                <th className="w-36 px-4 py-2.5">Provider</th>
                <th className="w-28 px-4 py-2.5">Status</th>
                <th className="w-28 px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const status = (log.status ?? 'pending') as BackupLogStatus;
                return (
                  <tr key={log.id} className="border-b border-line-soft/60 last:border-0">
                    <td className="px-4 py-3 text-xs text-ink-muted">
                      {formatRelativeTime(log.started_at)}
                      {log.completed_at && (
                        <span className="block text-[10px] text-ink-faint">
                          selesai {formatRelativeTime(log.completed_at)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="break-all font-mono text-[11px] text-ink">
                        {log.storage_file_name ?? log.backup_uuid ?? '—'}
                      </p>
                      {log.error_message && (
                        <p className="mt-0.5 text-[11px] text-red-400">{log.error_message}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                      {formatBytes(log.size_bytes)}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">{log.provider_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {log.download_url && (
                        <a
                          href={log.download_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent hover:underline"
                        >
                          ⬇ Cloud
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
