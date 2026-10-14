'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/lib/utils/toast';
import type { VpsListItem } from '@/types';
import { VpsCard } from './VpsCard';

interface VpsForm {
  name: string;
  host: string;
  port: string;
  username: string;
  credential: string;
}

const EMPTY_FORM: VpsForm = {
  name: '',
  host: '',
  port: '22',
  username: '',
  credential: '',
};

function formFromVps(vps: VpsListItem): VpsForm {
  return {
    name: vps.name,
    host: vps.host,
    port: String(vps.port),
    username: vps.username,
    credential: '',
  };
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string' && error) return error;
  }
  return fallback;
}

export function VpsManager({
  initialVps,
  currentUserId,
  canManageAll,
}: {
  initialVps: VpsListItem[];
  currentUserId: string;
  canManageAll: boolean;
}) {
  const [vpsList, setVpsList] = useState(initialVps);
  const [formOpen, setFormOpen] = useState(false);
  const [editingVps, setEditingVps] = useState<VpsListItem | null>(null);
  const [form, setForm] = useState<VpsForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canManage = (vps: VpsListItem) => canManageAll || vps.owner_id === currentUserId;

  function openCreate() {
    setEditingVps(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(vps: VpsListItem) {
    setEditingVps(vps);
    setForm(formFromVps(vps));
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setFormError(null);
  }

  function updateField(field: keyof VpsForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (formError) setFormError(null);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    const host = form.host.trim();
    const username = form.username.trim();
    const port = Number(form.port);

    if (!name || !host || !username) {
      setFormError('Nama, host, dan username wajib diisi.');
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setFormError('Port harus berupa angka antara 1 dan 65535.');
      return;
    }
    if (!editingVps && !form.credential) {
      setFormError('Credential wajib diisi saat menambahkan VPS.');
      return;
    }

    const payload: Record<string, string | number> = { name, host, port, username };
    // Empty credential on edit intentionally keeps the existing encrypted value.
    if (form.credential) payload.credential = form.credential;

    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch(
        editingVps ? `/api/vps/${encodeURIComponent(editingVps.id)}` : '/api/vps',
        {
          method: editingVps ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getErrorMessage(body, 'VPS gagal disimpan.'));

      const saved = (body as { vps?: VpsListItem }).vps;
      if (!saved) throw new Error('Response API tidak valid.');
      setVpsList((current) =>
        editingVps
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...current],
      );
      setFormOpen(false);
      setFormError(null);
      toast.success(editingVps ? 'VPS berhasil diperbarui.' : 'VPS berhasil ditambahkan.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'VPS gagal disimpan.';
      setFormError(message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteVps(vps: VpsListItem) {
    if (!window.confirm(`Hapus VPS "${vps.name}"? Data VPS dan assignment-nya akan dihapus.`)) return;

    setDeletingId(vps.id);
    try {
      const response = await fetch(`/api/vps/${encodeURIComponent(vps.id)}`, { method: 'DELETE' });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getErrorMessage(body, 'VPS gagal dihapus.'));
      setVpsList((current) => current.filter((item) => item.id !== vps.id));
      toast.success('VPS berhasil dihapus.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'VPS gagal dihapus.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">VPS</h1>
          <p className="mt-0.5 text-sm text-ink-muted">{vpsList.length} VPS yang dapat kamu akses</p>
        </div>
        <Button type="button" size="sm" onClick={openCreate}>
          + Tambah VPS
        </Button>
      </div>

      {vpsList.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-base-850/50 px-6 py-14 text-center">
          <p className="text-sm text-ink-muted">Belum ada VPS yang tersedia.</p>
          <p className="mt-2 text-xs text-ink-faint">
            Tambahkan VPS pertama kamu untuk membuka terminal dari panel.
          </p>
          <Button type="button" size="sm" className="mt-4" onClick={openCreate}>
            Tambah VPS
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vpsList.map((vps) => (
            <VpsCard
              key={vps.id}
              vps={vps}
              canManage={canManage(vps)}
              onEdit={() => openEdit(vps)}
              onDelete={() => void deleteVps(vps)}
              deleting={deletingId === vps.id}
            />
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingVps ? `Edit VPS: ${editingVps.name}` : 'Tambah VPS'}
      >
        <form className="space-y-4" onSubmit={(event) => void submitForm(event)}>
          <div className="rounded-lg border border-accent/20 bg-accent-soft px-3 py-2.5 text-xs text-ink-muted">
            Credential dienkripsi di server dan tidak pernah ditampilkan kembali setelah disimpan.
          </div>

          <Field label="Nama VPS" required>
            <Input
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              placeholder="VPS Production"
              autoComplete="off"
              maxLength={120}
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Host / IP address" required>
              <Input
                value={form.host}
                onChange={(event) => updateField('host', event.target.value)}
                placeholder="203.0.113.10"
                autoComplete="off"
                maxLength={253}
                required
              />
            </Field>
            <Field label="Port" required>
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(event) => updateField('port', event.target.value)}
                required
              />
            </Field>
          </div>

          <Field label="Username" required>
            <Input
              value={form.username}
              onChange={(event) => updateField('username', event.target.value)}
              placeholder="root"
              autoComplete="username"
              maxLength={128}
              required
            />
          </Field>

          <Field
            label={editingVps ? 'Credential baru (opsional)' : 'Password / credential'}
            hint={editingVps ? 'Kosongkan jika credential lama tetap digunakan.' : 'Credential akan dienkripsi sebelum disimpan.'}
            required={!editingVps}
          >
            <Input
              type="password"
              value={form.credential}
              onChange={(event) => updateField('credential', event.target.value)}
              placeholder={editingVps ? 'Kosongkan untuk mempertahankan credential lama' : 'Masukkan credential VPS'}
              autoComplete="new-password"
              maxLength={16384}
              required={!editingVps}
            />
          </Field>

          {formError && (
            <p role="alert" className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {formError}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={closeForm} disabled={saving}>
              Batal
            </Button>
            <Button type="submit" loading={saving}>
              {editingVps ? 'Simpan perubahan' : 'Tambahkan VPS'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
