'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import {
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_TYPE_LABELS,
  MAX_ANNOUNCEMENT_CONTENT,
  MAX_ANNOUNCEMENT_TITLE,
  isAnnouncementExpired,
} from '@/lib/announcements';
import { formatDateTime, formatRelativeTime, toDateTimeLocalValue } from '@/lib/utils/format';
import { toast } from '@/lib/utils/toast';
import type {
  AdminAnnouncementRow,
  AdminAnnouncementsResponse,
  AnnouncementType,
} from '@/types';

const typeTone: Record<AnnouncementType, 'blue' | 'yellow' | 'red' | 'green'> = {
  info: 'blue',
  warning: 'yellow',
  danger: 'red',
  success: 'green',
};

interface FormState {
  title: string;
  content: string;
  type: AnnouncementType;
  /** Nilai input datetime-local ('' = permanen). */
  expires_at: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  title: '',
  content: '',
  type: 'info',
  expires_at: '',
  is_active: true,
};

type StatusFilter = 'all' | 'live' | 'inactive' | 'expired';

function rowStatus(row: AdminAnnouncementRow): 'live' | 'inactive' | 'expired' {
  if (!row.is_active) return 'inactive';
  return isAnnouncementExpired(row.expires_at) ? 'expired' : 'live';
}

/**
 * /admin/announcements — kelola broadcast pengumuman: tabel semua pengumuman
 * (judul, tipe, status, tanggal dibuat, kedaluwarsa) + tambah/edit/hapus dan
 * toggle aktif/nonaktif. Yang tampil ke user adalah baris `live`.
 */
export function AnnouncementsAdmin() {
  const [rows, setRows] = useState<AdminAnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAnnouncementRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/announcements', { cache: 'no-store' });
      const data = (await res.json()) as AdminAnnouncementsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Gagal memuat pengumuman');
      setRows(data.announcements ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat pengumuman');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(row: AdminAnnouncementRow) {
    setEditing(row);
    setForm({
      title: row.title,
      content: row.content,
      type: row.type,
      expires_at: toDateTimeLocalValue(row.expires_at),
      is_active: row.is_active,
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function submitForm() {
    const title = form.title.trim();
    const content = form.content.trim();
    if (!title) return setFormError('Judul wajib diisi');
    if (title.length > MAX_ANNOUNCEMENT_TITLE) {
      return setFormError(`Judul maksimal ${MAX_ANNOUNCEMENT_TITLE} karakter`);
    }
    if (!content) return setFormError('Konten wajib diisi');
    if (content.length > MAX_ANNOUNCEMENT_CONTENT) {
      return setFormError(`Konten maksimal ${MAX_ANNOUNCEMENT_CONTENT} karakter`);
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        title,
        content,
        type: form.type,
        expires_at: form.expires_at ? form.expires_at : null,
        ...(editing ? { is_active: form.is_active } : {}),
      };
      const res = await fetch(
        editing ? `/api/admin/announcements/${editing.id}` : '/api/admin/announcements',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Gagal menyimpan pengumuman');
      toast.success(editing ? 'Pengumuman diperbarui' : 'Pengumuman dibuat');
      setModalOpen(false);
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan pengumuman');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: AdminAnnouncementRow) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/announcements/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !row.is_active }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Gagal mengubah status');
      setRows((prev) =>
        prev.map((item) => (item.id === row.id ? { ...item, is_active: !row.is_active } : item)),
      );
      toast.success(data.message ?? (row.is_active ? 'Pengumuman dinonaktifkan' : 'Pengumuman diaktifkan'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah status');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: AdminAnnouncementRow) {
    if (!window.confirm(`Hapus pengumuman "${row.title}"? Banner-nya langsung hilang dari panel semua user.`)) {
      return;
    }
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/announcements/${row.id}`, { method: 'DELETE' });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Gagal menghapus pengumuman');
      setRows((prev) => prev.filter((item) => item.id !== row.id));
      toast.success(data.message ?? 'Pengumuman dihapus');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus pengumuman');
    } finally {
      setBusyId(null);
    }
  }

  const query = q.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (statusFilter !== 'all' && rowStatus(row) !== statusFilter) return false;
    if (!query) return true;
    return [row.title, row.content, row.created_by_username]
      .filter(Boolean)
      .some((value) => (value as string).toLowerCase().includes(query));
  });

  const liveCount = rows.filter((row) => rowStatus(row) === 'live').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Announcements</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Broadcast pengumuman ke semua user panel — tampil sebagai banner di Dashboard &amp;
            Servers.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-52">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari judul / konten…"
              autoComplete="off"
            />
          </div>
          <div className="w-40">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Filter status"
            >
              <option value="all">Semua status</option>
              <option value="live">Sedang tayang</option>
              <option value="inactive">Nonaktif</option>
              <option value="expired">Kedaluwarsa</option>
            </Select>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            + Buat pengumuman
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Semua pengumuman"
          subtitle={`${filtered.length} ditampilkan · ${liveCount} sedang tayang`}
          action={
            <div className="flex items-center gap-2">
              <Badge tone="green">{liveCount} tayang</Badge>
              <Badge tone="default">{rows.length} total</Badge>
            </div>
          }
        />
        <div className="overflow-x-auto">
          {loading ? (
            <PageLoader label="Memuat pengumuman…" />
          ) : error ? (
            <div className="px-5 py-6 text-sm text-red-400">
              <p>{error}</p>
              <p className="mt-1 text-xs text-ink-faint">
                Pastikan migration <code className="rounded bg-base-700 px-1.5 py-0.5 font-mono">011_announcements.sql</code>{' '}
                sudah dijalankan di Supabase SQL Editor.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">
              {rows.length === 0
                ? 'Belum ada pengumuman. Klik "Buat pengumuman" untuk broadcast pertama.'
                : 'Tidak ada pengumuman yang cocok dengan filter.'}
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line-soft text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="px-5 py-3 font-medium">Judul</th>
                  <th className="px-5 py-3 font-medium">Tipe</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Dibuat</th>
                  <th className="px-5 py-3 font-medium">Kedaluwarsa</th>
                  <th className="px-5 py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const status = rowStatus(row);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-line-soft/60 last:border-0 hover:bg-base-800/40"
                    >
                      <td className="max-w-sm px-5 py-3">
                        <p className="truncate text-xs font-medium text-ink">{row.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-faint">
                          {row.content}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={typeTone[row.type] ?? 'default'}>
                          {ANNOUNCEMENT_TYPE_LABELS[row.type] ?? row.type}
                        </Badge>
                      </td>
                      <td className="px-5 py-3">
                        {status === 'live' && <Badge tone="green">Tayang</Badge>}
                        {status === 'inactive' && <Badge tone="gray">Nonaktif</Badge>}
                        {status === 'expired' && <Badge tone="yellow">Kedaluwarsa</Badge>}
                      </td>
                      <td className="px-5 py-3">
                        <p className="text-xs text-ink-muted">{formatRelativeTime(row.created_at)}</p>
                        <p className="text-[10px] text-ink-faint">
                          {row.created_by_username ?? 'system'} · {formatDateTime(row.created_at)}
                        </p>
                      </td>
                      <td className="px-5 py-3">
                        {row.expires_at ? (
                          <p className="text-xs text-ink-muted">{formatDateTime(row.expires_at)}</p>
                        ) : (
                          <p className="text-xs text-ink-faint">Permanen</p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant={row.is_active ? 'secondary' : 'success'}
                            size="sm"
                            disabled={busyId === row.id}
                            onClick={() => void toggleActive(row)}
                            title={row.is_active ? 'Sembunyikan dari user' : 'Tampilkan ke user'}
                          >
                            {row.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </Button>
                          <Button variant="ghost" size="sm" disabled={busyId === row.id} onClick={() => openEdit(row)}>
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={busyId === row.id}
                            onClick={() => void remove(row)}
                          >
                            Hapus
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit pengumuman — ${editing.title}` : 'Buat pengumuman baru'}
      >
        <div className="space-y-4">
          <Field label="Judul" required hint={`Maksimal ${MAX_ANNOUNCEMENT_TITLE} karakter`}>
            <Input
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Maintenance node 1 malam ini"
              maxLength={MAX_ANNOUNCEMENT_TITLE}
              autoFocus
            />
          </Field>

          <Field
            label="Konten"
            required
            hint={`Tampil di banner. Baris baru dipertahankan. Maksimal ${MAX_ANNOUNCEMENT_CONTENT} karakter.`}
          >
            <Textarea
              value={form.content}
              onChange={(e) => setForm((prev) => ({ ...prev, content: e.target.value }))}
              placeholder={'Semua server di node 1 akan dimatikan pukul 23:00 WIB selama ±30 menit.\nSimpan pekerjaan kamu sebelum waktu itu.'}
              rows={5}
              maxLength={MAX_ANNOUNCEMENT_CONTENT}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Tipe" hint="Menentukan warna banner">
              <Select
                value={form.type}
                onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as AnnouncementType }))}
              >
                {ANNOUNCEMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ANNOUNCEMENT_TYPE_LABELS[type]} — {type}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Berlaku hingga" hint="Kosongkan = permanen sampai dinonaktifkan">
              <Input
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) => setForm((prev) => ({ ...prev, expires_at: e.target.value }))}
              />
            </Field>
          </div>

          <div className="rounded-lg border border-line bg-base-900/60 px-3 py-2.5">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-ink-faint">Preview banner</p>
            <BannerPreview form={form} />
          </div>

          {editing && (
            <label className="flex items-center gap-2.5 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-line accent-accent"
              />
              Aktif (tampil sebagai banner di panel user)
            </label>
          )}

          {formError && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {formError}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 pt-1 md:flex-row md:justify-end">
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Batal
            </Button>
            <Button onClick={() => void submitForm()} loading={saving}>
              {editing ? 'Simpan perubahan' : 'Buat pengumuman'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** Preview kecil banner sesuai tipe — biar admin tahu warnanya sebelum tayang. */
function BannerPreview({ form }: { form: FormState }) {
  const previewStyles: Record<AnnouncementType, string> = {
    info: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    danger: 'border-red-500/30 bg-red-500/10 text-red-300',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  };
  return (
    <div className={`rounded-lg border px-3 py-2 ${previewStyles[form.type] ?? previewStyles.info}`}>
      <p className="text-xs font-semibold">{form.title.trim() || 'Judul pengumuman'}</p>
      <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-ink-muted">
        {form.content.trim() || 'Isi pengumuman muncul di sini…'}
      </p>
    </div>
  );
}
