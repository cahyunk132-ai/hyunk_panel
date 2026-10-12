'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { formatBytes, formatRelativeTime } from '@/lib/utils/format';
import { toast } from '@/lib/utils/toast';
import type { BackupLogRow, BackupLogStatus } from '@/types';

export type LogWithProvider = BackupLogRow & {
  provider_name: string | null;
  provider_type: string | null;
  download_url: string | null;
};

export type CloudRestoreStepStatus =
  | 'Mengunduh dari cloud...'
  | 'Mengupload ke server...'
  | 'Selesai!';

const STATUS_TONES: Record<BackupLogStatus, 'yellow' | 'green' | 'red'> = {
  pending: 'yellow',
  creating: 'yellow',
  uploading: 'yellow',
  done: 'green',
  failed: 'red',
};

/** Status yang masih berjalan → badge menampilkan spinner. */
const RUNNING_STATUSES: BackupLogStatus[] = ['pending', 'creating', 'uploading'];

const STATUS_LABELS: Record<BackupLogStatus, string> = {
  pending: 'Pending',
  creating: 'Creating…',
  uploading: 'Uploading…',
  done: 'Done',
  failed: 'Failed',
};

export function BackupHistory({
  serverId,
  canRestore = true,
}: {
  serverId: string;
  canRestore?: boolean;
}) {
  const [logs, setLogs] = useState<LogWithProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cloud Restore state
  const [cloudRestoringLog, setCloudRestoringLog] = useState<LogWithProvider | null>(null);
  const [truncateFiles, setTruncateFiles] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudRestoreStatus, setCloudRestoreStatus] = useState<CloudRestoreStepStatus | null>(null);
  const [cloudRestoreError, setCloudRestoreError] = useState<string | null>(null);

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

  function openCloudRestoreModal(log: LogWithProvider) {
    setCloudRestoringLog(log);
    setTruncateFiles(false);
    setCloudRestoreStatus(null);
    setCloudRestoreError(null);
  }

  function closeCloudRestoreModal() {
    if (cloudBusy) return;
    setCloudRestoringLog(null);
    setCloudRestoreStatus(null);
    setCloudRestoreError(null);
  }

  async function restoreFromCloud() {
    if (!cloudRestoringLog || cloudBusy) return;
    setCloudBusy(true);
    setCloudRestoreError(null);
    setCloudRestoreStatus('Mengunduh dari cloud...');

    let switchedToUpload = false;
    const stepTimer = setTimeout(() => {
      switchedToUpload = true;
      setCloudRestoreStatus('Mengupload ke server...');
    }, 1200);

    try {
      const res = await fetch(`/api/servers/${serverId}/backup-schedule/cloud-restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_id: cloudRestoringLog.id,
          backup_log_id: cloudRestoringLog.id,
          truncate: truncateFiles,
        }),
      });
      const json = await res.json().catch(() => ({}));
      clearTimeout(stepTimer);

      if (!res.ok) {
        throw new Error(json.error || 'Gagal melakukan restore backup dari cloud');
      }

      if (!switchedToUpload) {
        setCloudRestoreStatus('Mengupload ke server...');
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      setCloudRestoreStatus('Selesai!');
      toast.success(
        `Backup "${cloudRestoringLog.storage_file_name ?? cloudRestoringLog.backup_uuid ?? 'cloud'}" berhasil direstore dari cloud`,
      );

      await new Promise((resolve) => setTimeout(resolve, 900));
      setCloudRestoringLog(null);
      setCloudRestoreStatus(null);
    } catch (err) {
      clearTimeout(stepTimer);
      const message =
        err instanceof Error ? err.message : 'Gagal melakukan restore backup dari cloud';
      setCloudRestoreError(message);
      setCloudRestoreStatus(null);
      toast.error(message);
    } finally {
      setCloudBusy(false);
    }
  }

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

      {loading && logs.length === 0 ? (
        <div className="mt-4 overflow-x-auto" role="status" aria-busy="true" aria-label="Memuat history backup">
          <table className="w-full min-w-[720px] text-sm">
            <tbody>
              <SkeletonTableRows rows={4} cols={6} />
            </tbody>
          </table>
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
                <th className="w-56 px-4 py-2.5 text-right">Aksi</th>
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
                      <Badge tone={STATUS_TONES[status]} spinning={RUNNING_STATUSES.includes(status)}>
                        {STATUS_LABELS[status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
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
                        {status === 'done' && canRestore && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openCloudRestoreModal(log)}
                            className="border-accent/30 bg-accent/10 text-accent hover:bg-accent/20"
                          >
                            ☁️ Restore dari Cloud
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Konfirmasi Restore dari Cloud */}
      <Modal
        open={!!cloudRestoringLog}
        onClose={closeCloudRestoreModal}
        title="☁️ Restore dari Cloud"
      >
        <div className="space-y-4">
          {cloudRestoringLog && (
            <div className="rounded-lg border border-line bg-base-900/60 px-3.5 py-2.5 text-xs">
              <p className="font-mono text-ink">
                {cloudRestoringLog.storage_file_name ?? cloudRestoringLog.backup_uuid ?? '—'}
              </p>
              <p className="mt-1 text-ink-muted">
                Provider: <strong className="text-ink">{cloudRestoringLog.provider_name ?? 'Cloud'}</strong>
                {cloudRestoringLog.size_bytes ? ` · Ukuran: ${formatBytes(cloudRestoringLog.size_bytes)}` : ''}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <p className="font-medium text-amber-300">⚠️ Peringatan</p>
            <p className="mt-0.5 text-xs text-amber-200/90">
              Restore akan menimpa file server yang ada
            </p>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-line bg-base-900/60 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink">Truncate files</p>
              <p className="text-xs text-ink-muted">
                Hapus semua file lama sebelum restore
              </p>
            </div>
            <input
              type="checkbox"
              role="switch"
              aria-checked={truncateFiles}
              checked={truncateFiles}
              disabled={cloudBusy}
              onChange={(e) => setTruncateFiles(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-[#3ecfcf] disabled:cursor-not-allowed"
            />
          </label>

          {cloudRestoreStatus && (
            <div
              className={`rounded-lg border px-4 py-3 text-xs font-medium ${
                cloudRestoreStatus === 'Selesai!'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-accent/30 bg-accent/10 text-accent'
              }`}
              role="status"
            >
              {cloudRestoreStatus}
            </div>
          )}

          {cloudRestoreError && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {cloudRestoreError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={closeCloudRestoreModal}
              disabled={cloudBusy}
            >
              Batal
            </Button>
            <Button
              size="sm"
              onClick={restoreFromCloud}
              loading={cloudBusy}
              disabled={cloudBusy || cloudRestoreStatus === 'Selesai!'}
            >
              {cloudRestoreStatus ?? 'Restore'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
