'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/Spinner';
import { formatBytes, formatRelativeTime } from '@/lib/utils/format';
import type { BackupInterval, BackupLogRow, BackupLogStatus, BackupScheduleRow } from '@/types';

interface AdminScheduleRow extends BackupScheduleRow {
  servers: { id: string; name: string; uuid: string; status: string } | null;
  storage_providers: { id: string; name: string; provider: string } | null;
  last_log: BackupLogRow | null;
}

const INTERVAL_LABELS: Record<BackupInterval, string> = {
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
};

const LOG_STATUS_TONES: Record<BackupLogStatus, 'yellow' | 'green' | 'red' | 'gray'> = {
  pending: 'yellow',
  creating: 'yellow',
  uploading: 'yellow',
  done: 'green',
  failed: 'red',
};

export function BackupSchedulesAdmin() {
  const [schedules, setSchedules] = useState<AdminScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/backups', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal memuat jadwal backup');
      setSchedules(json.schedules ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function forceRun(schedule: AdminScheduleRow) {
    setRunningId(schedule.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/backups/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_id: schedule.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menjalankan backup');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setRunningId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Auto Backups</h1>
        <p className="text-sm text-ink-muted">
          Overview semua jadwal backup otomatis di semua server. Force run menjalankan pipeline backup
          (Wings → cloud storage) sekarang juga.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <PageLoader label="Memuat jadwal backup…" />
      ) : schedules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-base-850/50 px-6 py-14 text-center text-sm text-ink-faint">
          Belum ada jadwal auto backup. Atur per server di tab Backups.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-base-850">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5">Server</th>
                <th className="w-40 px-4 py-2.5">Provider</th>
                <th className="w-32 px-4 py-2.5">Jadwal</th>
                <th className="w-24 px-4 py-2.5">Retention</th>
                <th className="w-28 px-4 py-2.5">Status</th>
                <th className="w-44 px-4 py-2.5">Next run</th>
                <th className="w-44 px-4 py-2.5">Last run</th>
                <th className="w-32 px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => {
                const last = s.last_log;
                return (
                  <tr key={s.id} className="border-b border-line-soft/60 last:border-0">
                    <td className="px-4 py-3">
                      {s.servers ? (
                        <Link
                          href={`/servers/${s.servers.id}/backups`}
                          className="font-medium text-ink transition-colors hover:text-accent"
                        >
                          {s.servers.name}
                        </Link>
                      ) : (
                        <span className="text-ink-faint">server dihapus</span>
                      )}
                      {s.servers && (
                        <p className="font-mono text-[10px] text-ink-faint">{s.servers.uuid}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">
                      {s.storage_providers?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">
                      {INTERVAL_LABELS[s.interval]}
                      {s.interval !== 'hourly' && ` ${s.time_of_day ?? '03:00'}`}
                      {s.interval === 'weekly' && ` · dow ${s.day_of_week ?? 0}`}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted">{s.retention}</td>
                    <td className="px-4 py-3">
                      <Badge tone={s.is_enabled ? 'green' : 'gray'}>
                        {s.is_enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">
                      {s.next_run_at ? new Date(s.next_run_at).toLocaleString('id-ID') : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-muted">
                      {last ? (
                        <div>
                          <Badge tone={LOG_STATUS_TONES[(last.status ?? 'pending') as BackupLogStatus]}>
                            {last.status ?? 'pending'}
                          </Badge>
                          <span className="ml-1">{formatRelativeTime(last.started_at)}</span>
                          {last.status === 'done' && last.size_bytes != null && (
                            <span className="ml-1 text-ink-faint">· {formatBytes(last.size_bytes)}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-ink-faint">belum pernah</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!s.is_enabled || runningId === s.id}
                        onClick={() => forceRun(s)}
                      >
                        {runningId === s.id ? 'Running…' : '▶ Force run'}
                      </Button>
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
