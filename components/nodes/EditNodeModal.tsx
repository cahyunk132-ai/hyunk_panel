'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';

export interface EditableNode {
  id: string;
  name: string;
  fqdn: string;
  port: number;
  location: string;
  memory_total_mb: number | null;
  disk_total_mb: number | null;
}

export function EditNodeModal({
  node,
  open,
  onClose,
}: {
  node: EditableNode;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.get('name'),
        fqdn: form.get('fqdn'),
        port: Number(form.get('port')) || 8080,
        location: form.get('location') || 'ID',
      };
      const mem = Number(form.get('memory_total_mb'));
      const disk = Number(form.get('disk_total_mb'));
      payload.memory_total_mb = mem > 0 ? mem : null;
      payload.disk_total_mb = disk > 0 ? disk : null;
      if (token.trim()) payload.token = token.trim();

      const res = await fetch(`/api/nodes/${node.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan');
      setToken('');
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Edit node — ${node.name}`}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Nama node" required>
          <Input name="name" defaultValue={node.name} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="FQDN" required>
            <Input name="fqdn" defaultValue={node.fqdn} required />
          </Field>
          <Field label="Port Wings" required>
            <Input name="port" type="number" defaultValue={node.port} required />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Lokasi">
            <Input name="location" defaultValue={node.location} />
          </Field>
          <Field label="RAM total (MB)">
            <Input name="memory_total_mb" type="number" defaultValue={node.memory_total_mb ?? ''} placeholder="opsional" />
          </Field>
          <Field label="Disk total (MB)">
            <Input name="disk_total_mb" type="number" defaultValue={node.disk_total_mb ?? ''} placeholder="opsional" />
          </Field>
        </div>

        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3">
          <Field
            label="Rotasi token Wings (opsional)"
            hint="Diisi HANYA jika token di config.yml node berubah. Langsung dienkripsi AES-256-GCM."
          >
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              placeholder="biarkan kosong untuk tidak mengganti"
              autoComplete="off"
            />
          </Field>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" loading={loading}>
            Simpan
          </Button>
        </div>
      </form>
    </Modal>
  );
}
