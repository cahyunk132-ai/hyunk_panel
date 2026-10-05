'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';

export function NewNodeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          fqdn: form.get('fqdn'),
          port: Number(form.get('port')) || 8080,
          uuid: form.get('uuid'),
          token_id: form.get('token_id'),
          token: form.get('token'),
          location: form.get('location') || 'ID',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menambah node');
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + Node baru
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Tambah node">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Nama node" required>
            <Input name="name" placeholder="Node 3 — SG" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="FQDN" required>
              <Input name="fqdn" placeholder="node3.example.com" required />
            </Field>
            <Field label="Port Wings" required>
              <Input name="port" type="number" defaultValue={8080} required />
            </Field>
          </div>
          <Field label="Node UUID" hint="uuid di /etc/pterodactyl/config.yml" required>
            <Input name="uuid" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Token ID" hint="field token_id di config.yml" required>
              <Input name="token_id" required />
            </Field>
            <Field label="Token (secret)" hint="field token di config.yml — akan dienkripsi" required>
              <Input name="token" type="password" required />
            </Field>
          </div>
          <Field label="Lokasi">
            <Input name="location" placeholder="ID" />
          </Field>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button type="submit" loading={loading}>
              Simpan node
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
