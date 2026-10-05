'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDangerModal } from '@/components/ui/Modal';
import { EditNodeModal, type EditableNode } from './EditNodeModal';

export function NodeAdminActions({
  node,
  isMaintenance,
  serverCount,
}: {
  node: EditableNode;
  isMaintenance: boolean;
  serverCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nodeId = node.id;
  const nodeName = node.name;

  async function toggleMaintenance() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_maintenance: !isMaintenance }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setBusy(false);
    }
  }

  async function deleteNode() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/nodes/${nodeId}?force=true`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menghapus node');
      router.replace('/nodes');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
          ✎ Edit node
        </Button>
        <Button size="sm" variant="secondary" onClick={toggleMaintenance} loading={busy}>
          {isMaintenance ? 'Matikan maintenance' : 'Mode maintenance'}
        </Button>
        <Button size="sm" variant="danger" onClick={() => setConfirmOpen(true)}>
          Hapus dari panel
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      <EditNodeModal node={node} open={editOpen} onClose={() => setEditOpen(false)} />

      <ConfirmDangerModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={deleteNode}
        title="Hapus node dari panel?"
        description={
          <>
            Menghapus node <strong>{nodeName}</strong> ({serverCount} server) dari database panel.
            Container dan data di mesin <strong>tidak disentuh</strong> — server hanya hilang dari
            panel dan bisa didaftarkan ulang.
          </>
        }
        confirmText={nodeName}
        typedValue={typed}
        setTypedValue={setTyped}
        loading={busy}
        dangerLabel="Hapus dari panel"
      />
    </div>
  );
}
