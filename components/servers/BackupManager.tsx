'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDangerModal } from '@/components/ui/Modal';
import { Input, Field, Textarea } from '@/components/ui/Input';
import { SkeletonTableRows } from '@/components/ui/Skeleton';
import { formatBytes, formatRelativeTime } from '@/lib/utils/format';
import { toast, toastOperation } from '@/lib/utils/toast';
import type { BackupLogRow, BackupLogStatus, BackupRow } from '@/types';

type LogWithProvider = BackupLogRow & {
  provider_name: string | null;
  provider_type: string | null;
  download_url: string | null;
};

type CloudRestoreStepStatus = 'Memulai restore...' | 'Restore berjalan di background';

const LOG_STATUS_TONES: Record<BackupLogStatus, 'yellow' | 'green' | 'red'> = {
  pending: 'yellow',
  creating: 'yellow',
  uploading: 'yellow',
  done: 'green',
  failed: 'red',
};

const RUNNING_LOG_STATUSES: BackupLogStatus[] = ['pending', 'creating', 'uploading'];

const LOG_STATUS_LABELS: Record<BackupLogStatus, string> = {
  pending: 'Pending',
  creating: 'Creating…',
  uploading: 'Uploading…',
  done: 'Done',
  failed: 'Failed',
};

export function BackupManager({
  serverId,
  canDelete,
  canRestore,
  showHistory = false,
}: {
  serverId: string;
  canDelete: boolean;
  canRestore: boolean;
  showHistory?: boolean;
}) {
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [ignored, setIgnored] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<BackupRow | null>(null);
  const [typed, setTyped] = useState('');
  const [restoring, setRestoring] = useState<BackupRow | null>(null);

  // Cloud Backup History & Cloud Restore state
  const [cloudLogs, setCloudLogs] = useState<LogWithProvider[]>([]);
  const [cloudLogsLoading, setCloudLogsLoading] = useState(showHistory);
  const [cloudRestoringLog, setCloudRestoringLog] = useState<LogWithProvider | null>(null);
  const [truncateFiles, setTruncateFiles] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudRestoreStatus, setCloudRestoreStatus] = useState<CloudRestoreStepStatus | null>(null);
  const [cloudRestoreError, setCloudRestoreError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/servers/${serverId}/backups`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal memuat backup');
      setBackups(json.backups ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  const loadCloudLogs = useCallback(async () => {
    if (!showHistory) return;
    try {
      const res = await fetch(`/api/servers/${serverId}/backup-logs`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal memuat history');
      setCloudLogs(json.logs ?? []);
    } catch {
      // ditangani di section BackupHistory utama bila dirender terpisah
    } finally {
      setCloudLogsLoading(false);
    }
  }, [serverId, showHistory]);

  useEffect(() => {
    load();
    loadCloudLogs();
    const t = setInterval(() => {
      load();
      loadCloudLogs();
    }, 30_000);
    return () => clearInterval(t);
  }, [load, loadCloudLogs]);

  async function createBackup() {
    setBusy(true);
    setError(null);
    try {
      await toastOperation(
        async () => {
          const res = await fetch(`/api/servers/${serverId}/backups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name || undefined, ignored_files: ignored }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || 'Gagal membuat backup');
        },
        {
          loading: 'Membuat backup server…',
          success: 'Backup dibuat — status akan diperbarui di daftar',
        },
      );
      setCreateOpen(false);
      setName('');
      setIgnored('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setBusy(false);
    }
  }

  async function downloadBackup(backup: BackupRow) {
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/backups/${backup.id}`);
      const json = await res.json();
      if (!res.ok || !json.download_url) throw new Error(json.error || 'URL download tidak tersedia');
      window.open(json.download_url as string, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    }
  }

  async function restoreBackup(backup: BackupRow, truncate: boolean) {
    setBusy(true);
    setError(null);
    try {
      await toastOperation(
        async () => {
          const res = await fetch(`/api/servers/${serverId}/backups/${backup.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ truncate }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || 'Gagal restore');
        },
        {
          loading: `Merestore backup node "${backup.name ?? backup.uuid ?? ''}"…`,
          success: 'Backup dari node berhasil direstore',
        },
      );
      setRestoring(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setBusy(false);
    }
  }

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
    setCloudRestoreStatus('Memulai restore...');

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

      if (!res.ok) {
        throw new Error(json.error || 'Gagal melakukan restore backup dari cloud');
      }

      setCloudRestoreStatus('Restore berjalan di background');
      const message = typeof json.message === 'string' ? json.message : 'Restore dimulai.';
      toast.success(`${message} Pantau status server di tab Console/Overview.`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal melakukan restore backup dari cloud';
      setCloudRestoreError(message);
      setCloudRestoreStatus(null);
      toast.error(message);
    } finally {
      setCloudBusy(false);
    }
  }

  async function deleteBackup(backup: BackupRow) {
    setBusy(true);
    setError(null);
    try {
      await toastOperation(
        async () => {
          const res = await fetch(`/api/servers/${serverId}/backups/${backup.id}`, { method: 'DELETE' });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || 'Gagal menghapus');
        },
        { loading: 'Menghapus backup…', success: 'Backup dihapus' },
      );
      setDeleting(null);
      setTyped('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {showHistory && (
        <div className="rounded-xl border border-line bg-base-850 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink">Backup History</h3>
              <p className="text-xs text-ink-muted">Riwayat auto backup ke cloud storage.</p>
            </div>
          </div>

          {cloudLogsLoading && cloudLogs.length === 0 ? (
            <div className="mt-4 overflow-x-auto" role="status" aria-busy="true" aria-label="Memuat history backup">
              <table className="w-full min-w-[720px] text-sm">
                <tbody>
                  <SkeletonTableRows rows={4} cols={6} />
                </tbody>
              </table>
            </div>
          ) : cloudLogs.length === 0 ? (
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
                  {cloudLogs.map((log) => {
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
                          <Badge
                            tone={LOG_STATUS_TONES[status]}
                            spinning={RUNNING_LOG_STATUSES.includes(status)}
                          >
                            {LOG_STATUS_LABELS[status]}
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
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-muted">
          Backup disimpan lokal di node (adapter <code className="font-mono text-xs">wings</code>).
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          + Backup baru
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && backups.length === 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-base-850" role="status" aria-busy="true" aria-label="Memuat daftar backup">
          <table className="w-full min-w-[620px] text-sm">
            <tbody>
              <SkeletonTableRows rows={4} cols={5} />
            </tbody>
          </table>
        </div>
      ) : backups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-base-850/50 px-6 py-14 text-center text-sm text-ink-faint">
          Belum ada backup.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-base-850">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2.5">Nama</th>
                <th className="w-32 px-4 py-2.5">Status</th>
                <th className="w-28 px-4 py-2.5">Ukuran</th>
                <th className="w-32 px-4 py-2.5">Dibuat</th>
                <th className="w-52 px-4 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id} className="border-b border-line-soft/60 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{b.name ?? '—'}</p>
                    <p className="font-mono text-[10px] text-ink-faint">{b.uuid}</p>
                  </td>
                  <td className="px-4 py-3">
                    {b.is_successful === null ? (
                      <Badge tone="yellow" spinning>
                        Berjalan…
                      </Badge>
                    ) : b.is_successful ? (
                      <Badge tone="green">Sukses</Badge>
                    ) : (
                      <Badge tone="red">Gagal</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-muted">
                    {b.size_bytes ? formatBytes(b.size_bytes) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-muted">
                    {formatRelativeTime(b.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {b.is_successful && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Download backup dari node Wings"
                            onClick={() => downloadBackup(b)}
                          >
                            ⬇
                          </Button>
                          {canRestore && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Restore dari backup lokal di node Wings"
                              onClick={() => setRestoring(b)}
                            >
                              ↺ Restore Node
                            </Button>
                          )}
                        </>
                      )}
                      {canDelete && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Hapus backup dari node Wings"
                          onClick={() => setDeleting(b)}
                        >
                          🗑
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Backup baru">
        <div className="space-y-4">
          <Field label="Nama backup">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sebelum update plugin" />
          </Field>
          <Field
            label="Ignored files"
            hint="Pola file yang di-skip, satu per baris (mis. logs/*.log)"
          >
            <Textarea rows={3} value={ignored} onChange={(e) => setIgnored(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>
              Batal
            </Button>
            <Button size="sm" onClick={createBackup} loading={busy}>
              Mulai backup
            </Button>
          </div>
        </div>
      </Modal>

      {/* Restore lokal dari node Wings */}
      <Modal open={!!restoring} onClose={() => setRestoring(null)} title="Restore backup dari Node?">
        <p className="text-sm text-ink-muted">
          Restore <strong>{restoring?.name}</strong> dari penyimpanan lokal node Wings? File saat ini
          akan ditimpa oleh isi backup. Server sebaiknya dalam keadaan mati.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRestoring(null)}>
            Batal
          </Button>
          <Button variant="danger" size="sm" onClick={() => restoring && restoreBackup(restoring, true)} loading={busy}>
            Restore (timpa file)
          </Button>
          <Button size="sm" onClick={() => restoring && restoreBackup(restoring, false)} loading={busy}>
            Restore (tanpa timpa)
          </Button>
        </div>
      </Modal>

      {/* Restore dari Cloud */}
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
                cloudRestoreStatus === 'Restore berjalan di background'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-accent/30 bg-accent/10 text-accent'
              }`}
              role="status"
            >
              {cloudRestoreStatus}
              {cloudRestoreStatus === 'Restore berjalan di background' && (
                <p className="mt-1 font-normal opacity-90">
                  Pantau status server dari tab Console/Overview.
                </p>
              )}
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
              {cloudRestoreStatus === 'Restore berjalan di background' ? 'Tutup' : 'Batal'}
            </Button>
            <Button
              size="sm"
              onClick={restoreFromCloud}
              loading={cloudBusy}
              disabled={cloudBusy || cloudRestoreStatus === 'Restore berjalan di background'}
            >
              {cloudRestoreStatus === 'Restore berjalan di background'
                ? 'Restore dimulai'
                : cloudRestoreStatus ?? 'Restore'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete */}
      <ConfirmDangerModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteBackup(deleting)}
        title="Hapus backup?"
        description={<>Backup akan dihapus permanen dari node dan tidak bisa dikembalikan.</>}
        confirmText={deleting?.uuid?.slice(0, 8) ?? 'hapus'}
        typedValue={typed}
        setTypedValue={setTyped}
        loading={busy}
        dangerLabel="Hapus backup"
      />
    </div>
  );
}
