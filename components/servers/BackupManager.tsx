'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDangerModal } from '@/components/ui/Modal';
import { Input, Field, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { formatBytes, formatRelativeTime } from '@/lib/utils/format';
import type { BackupRow } from '@/types';

export function BackupManager({
  serverId,
  canDelete,
  canRestore,
}: {
  serverId: string;
  canDelete: boolean;
  canRestore: boolean;
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

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function createBackup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/backups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || undefined, ignored_files: ignored }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal membuat backup');
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
      const res = await fetch(`/api/servers/${serverId}/backups/${backup.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ truncate }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal restore');
      setRestoring(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setBusy(false);
    }
  }

  async function deleteBackup(backup: BackupRow) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${serverId}/backups/${backup.id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menghapus');
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

      {loading ? (
        <PageLoader label="Memuat backup…" />
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
                <th className="w-44 px-4 py-2.5 text-right">Aksi</th>
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
                      <Badge tone="yellow">Berjalan…</Badge>
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
                          <Button size="sm" variant="ghost" onClick={() => downloadBackup(b)}>
                            ⬇
                          </Button>
                          {canRestore && (
                            <Button size="sm" variant="ghost" onClick={() => setRestoring(b)}>
                              ↺
                            </Button>
                          )}
                        </>
                      )}
                      {canDelete && (
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(b)}>
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

      {/* Restore */}
      <Modal open={!!restoring} onClose={() => setRestoring(null)} title="Restore backup?">
        <p className="text-sm text-ink-muted">
          Restore <strong>{restoring?.name}</strong>? File saat ini akan ditimpa oleh isi backup.
          Server sebaiknya dalam keadaan mati.
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
