'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { PowerAction } from '@/types';
import { Modal } from '@/components/ui/Modal';

export function PowerButtons({
  serverId,
  status,
  disabled,
}: {
  serverId: string;
  status: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<PowerAction | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: PowerAction) {
    setBusy(action);
    setError(null);
    setConfirmKill(false);
    try {
      const res = await fetch(`/api/servers/${serverId}/power`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Gagal (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim aksi power');
    } finally {
      setBusy(null);
    }
  }

  const isRunning = status === 'running';
  const isOffline = status === 'offline';

  return (
    <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap md:items-center md:gap-2">
      <Button
        size="sm"
        variant="success"
        onClick={() => send('start')}
        loading={busy === 'start'}
        disabled={disabled || isRunning}
        title="Start server"
      >
        ▶ Start
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => send('restart')}
        loading={busy === 'restart'}
        disabled={disabled || isOffline}
      >
        ↻ Restart
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => send('stop')}
        loading={busy === 'stop'}
        disabled={disabled || isOffline}
      >
        ■ Stop
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={() => setConfirmKill(true)}
        disabled={disabled || isOffline}
      >
        ✕ Kill
      </Button>
      {error && <span className="col-span-2 text-xs text-red-400 md:col-span-1">{error}</span>}

      <Modal open={confirmKill} onClose={() => setConfirmKill(false)} title="Kill server?">
        <p className="text-sm text-ink-muted">
          <strong className="text-red-400">Kill</strong> menghentikan proses secara paksa (SIGKILL).
          Data yang belum tersimpan bisa hilang. Gunakan hanya jika server tidak merespons
          perintah stop.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirmKill(false)}>
            Batal
          </Button>
          <Button variant="danger" size="sm" onClick={() => send('kill')} loading={busy === 'kill'}>
            Ya, kill sekarang
          </Button>
        </div>
      </Modal>
    </div>
  );
}
