'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Field, Select, Textarea } from '@/components/ui/Input';
import { ConfirmDangerModal, Modal } from '@/components/ui/Modal';
import type { AllocationRow, ServerRow } from '@/types';

interface EnvRow {
  id: string;
  key: string;
  value: string;
}

type ServerAllocation = Pick<AllocationRow, 'id' | 'ip' | 'port'> & { is_primary?: boolean };

const IMAGE_PRESETS = [
  'ghcr.io/pterodactyl/yolks:java_21',
  'ghcr.io/pterodactyl/yolks:java_17',
  'ghcr.io/pterodactyl/yolks:java_11',
  'ghcr.io/pterodactyl/yolks:java_8',
  'ghcr.io/ptero-eggs/yolks:debian',
  'ghcr.io/ptero-eggs/yolks:nodejs_20',
  'ghcr.io/ptero-eggs/yolks:nodejs_22',
] as const;

function initialEnvRows(env: Record<string, string> | null | undefined): EnvRow[] {
  return Object.entries(env ?? {}).map(([key, value], index) => ({
    id: `env-${index}`,
    key,
    value: String(value ?? ''),
  }));
}

function displayAllocation(allocation: Pick<AllocationRow, 'ip' | 'port'>): string {
  return `${allocation.ip}:${allocation.port}`;
}

export function ServerSettings({
  server,
  isAdmin,
  primaryAllocation,
}: {
  server: ServerRow;
  isAdmin: boolean;
  primaryAllocation: Pick<AllocationRow, 'ip' | 'port'> | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: server.name,
    memory_mb: server.memory_mb,
    cpu_limit: server.cpu_limit,
    disk_mb: server.disk_mb ?? 10240,
    startup: server.startup,
    image: server.image,
  });
  const [envRows, setEnvRows] = useState<EnvRow[]>(() => initialEnvRows(server.env));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reinstallOpen, setReinstallOpen] = useState(false);
  const [reinstallSaveFirst, setReinstallSaveFirst] = useState(false);
  const [reinstallTyped, setReinstallTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteDataOnNode, setDeleteDataOnNode] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');

  const [allocations, setAllocations] = useState<ServerAllocation[]>([]);
  const [availableAllocations, setAvailableAllocations] = useState<ServerAllocation[]>([]);
  const [selectedAllocation, setSelectedAllocation] = useState('');
  const [allocationsLoading, setAllocationsLoading] = useState(true);
  const [allocationBusy, setAllocationBusy] = useState(false);
  const [allocationMessage, setAllocationMessage] = useState<string | null>(null);
  const [allocationError, setAllocationError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const loadAllocations = useCallback(async () => {
    setAllocationsLoading(true);
    setAllocationError(null);
    try {
      const response = await fetch(`/api/servers/${server.id}/allocations`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal memuat port server');
      setAllocations(Array.isArray(json.allocations) ? json.allocations : []);
      setAvailableAllocations(Array.isArray(json.available) ? json.available : []);
    } catch (err) {
      setAllocationError(err instanceof Error ? err.message : 'Gagal memuat port server');
    } finally {
      setAllocationsLoading(false);
    }
  }, [server.id]);

  useEffect(() => {
    void loadAllocations();
  }, [loadAllocations]);

  const envForPreview = useMemo(() => {
    const env: Record<string, string> = {};
    for (const row of envRows) {
      const key = row.key.trim();
      if (key) env[key] = row.value;
    }
    // Samakan dengan environment bawaan yang dikirim panel ke Wings.
    env.SERVER_MEMORY = String(form.memory_mb);
    env.SERVER_IP = primaryAllocation?.ip ?? '0.0.0.0';
    env.SERVER_PORT = String(primaryAllocation?.port ?? 0);
    return env;
  }, [envRows, form.memory_mb, primaryAllocation]);

  const startupPreview = useMemo(
    () =>
      form.startup.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (placeholder, key: string) =>
        Object.prototype.hasOwnProperty.call(envForPreview, key) ? envForPreview[key] : placeholder,
      ),
    [envForPreview, form.startup],
  );

  function collectEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const row of envRows) {
      const key = row.key.trim();
      if (!key && !row.value.trim()) continue;
      if (!key) throw new Error('Key environment variable tidak boleh kosong.');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Key "${key}" tidak valid. Gunakan huruf, angka, dan underscore.`);
      }
      if (Object.prototype.hasOwnProperty.call(env, key)) {
        throw new Error(`Environment variable "${key}" ditambahkan lebih dari sekali.`);
      }
      env[key] = row.value;
    }
    return env;
  }

  function buildSavePayload() {
    if (!Number.isFinite(Number(form.memory_mb)) || Number(form.memory_mb) < 128) {
      throw new Error('Memory minimal 128 MB');
    }
    if (!Number.isFinite(Number(form.cpu_limit)) || Number(form.cpu_limit) < 1) {
      throw new Error('CPU limit harus lebih besar dari 0');
    }
    if (!Number.isFinite(Number(form.disk_mb)) || Number(form.disk_mb) < 1024) {
      throw new Error('Disk minimal 1024 MB');
    }
    if (!form.name.trim()) throw new Error('Nama server wajib diisi.');
    if (!form.image.trim()) throw new Error('Docker image wajib diisi.');
    if (!form.startup.trim()) throw new Error('Startup command wajib diisi.');
    return {
      name: form.name.trim(),
      memory_mb: Number(form.memory_mb),
      cpu_limit: Number(form.cpu_limit),
      disk_mb: Number(form.disk_mb),
      startup: form.startup,
      image: form.image.trim(),
      env: collectEnv(),
    };
  }

  async function persistConfiguration() {
    const response = await fetch(`/api/servers/${server.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSavePayload()),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json.error || 'Gagal menyimpan konfigurasi');
    return json as { wings_synced?: boolean; wings_sync_error?: string | null };
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const result = await persistConfiguration();
      setMessage(
        result.wings_synced === false
          ? `Konfigurasi tersimpan di panel, tetapi Wings belum tersinkron: ${result.wings_sync_error ?? 'node tidak merespons'}`
          : 'Konfigurasi tersimpan dan perubahan telah dikirim ke Wings.',
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan konfigurasi');
    } finally {
      setSaving(false);
    }
  }

  async function toggleSuspend() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/servers/${server.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_suspended: !server.is_suspended }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal mengubah status server');
      setMessage(
        json.wings_synced === false
          ? `Status panel berubah, tetapi Wings belum tersinkron: ${json.wings_sync_error ?? 'node tidak merespons'}`
          : server.is_suspended
            ? 'Server di-unsuspend.'
            : 'Server disuspend.',
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setSaving(false);
    }
  }

  function openReinstall(saveFirst: boolean) {
    setError(null);
    setReinstallTyped('');
    setReinstallSaveFirst(saveFirst);
    setReinstallOpen(true);
  }

  async function confirmReinstall() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let syncWarning: string | null = null;
      if (reinstallSaveFirst) {
        const saved = await persistConfiguration();
        if (saved.wings_synced === false) syncWarning = saved.wings_sync_error ?? 'Wings belum tersinkron.';
      }

      const response = await fetch(`/api/servers/${server.id}/reinstall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: reinstallSaveFirst ? form.name.trim() : server.name }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal memulai reinstall');

      setReinstallOpen(false);
      setReinstallTyped('');
      setMessage(
        syncWarning
          ? `Reinstall dimulai, tetapi sinkronisasi konfigurasi Wings melaporkan: ${syncWarning}`
          : 'Reinstall dimulai. Membuka Console untuk memantau proses…',
      );
      router.replace(`/servers/${server.id}/console`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memulai reinstall');
    } finally {
      setBusy(false);
    }
  }

  async function deleteServer() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/servers/${server.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destroy: deleteDataOnNode, confirm: deleteTyped }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal menghapus server');
      router.replace('/servers');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus server');
      setBusy(false);
    }
  }

  async function addAllocation() {
    if (!selectedAllocation) return;
    setAllocationBusy(true);
    setAllocationError(null);
    setAllocationMessage(null);
    try {
      const response = await fetch(`/api/servers/${server.id}/allocations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocation_id: selectedAllocation }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal menambahkan port');
      setSelectedAllocation('');
      setAllocationMessage(
        json.wings_synced === false
          ? `Port berhasil ditambahkan, tetapi sinkronisasi Wings gagal: ${json.wings_sync_error ?? 'node tidak merespons'}`
          : 'Port tambahan berhasil ditambahkan dan disinkronkan ke Wings.',
      );
      await loadAllocations();
    } catch (err) {
      setAllocationError(err instanceof Error ? err.message : 'Gagal menambahkan port');
    } finally {
      setAllocationBusy(false);
    }
  }

  async function removeAllocation(allocationId: string) {
    setAllocationBusy(true);
    setAllocationError(null);
    setAllocationMessage(null);
    try {
      const response = await fetch(`/api/servers/${server.id}/allocations`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allocation_id: allocationId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal menghapus port tambahan');
      setAllocationMessage(
        json.wings_synced === false
          ? `Port dilepas, tetapi sinkronisasi Wings gagal: ${json.wings_sync_error ?? 'node tidak merespons'}`
          : 'Port tambahan dilepas dari server.',
      );
      await loadAllocations();
    } catch (err) {
      setAllocationError(err instanceof Error ? err.message : 'Gagal menghapus port tambahan');
    } finally {
      setAllocationBusy(false);
    }
  }

  const imagePreset = IMAGE_PRESETS.includes(form.image as (typeof IMAGE_PRESETS)[number])
    ? form.image
    : 'custom';

  return (
    <div className="grid max-w-4xl gap-4">
      <Card>
        <CardHeader title="Konfigurasi server" subtitle="Batas resource dan nama server" />
        <div className="space-y-4 px-5 py-4">
          <Field label="Nama server" required>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Memory (MB)" required>
              <Input
                type="number"
                min={128}
                value={form.memory_mb}
                onChange={(e) => set('memory_mb', Number(e.target.value))}
              />
            </Field>
            <Field label="CPU limit (%)" hint="100 = 1 core penuh" required>
              <Input
                type="number"
                min={25}
                step={25}
                value={form.cpu_limit}
                onChange={(e) => set('cpu_limit', Number(e.target.value))}
              />
            </Field>
            <Field label="Disk (MB)" hint="Min. 1024 MB" required>
              <Input
                type="number"
                min={1024}
                step={512}
                value={form.disk_mb}
                onChange={(e) => set('disk_mb', Number(e.target.value))}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Startup & Image"
          subtitle="Edit image, startup command, dan environment variables server"
        />
        <div className="space-y-4 px-5 py-4">
          <Field label="Preset Docker image">
            <Select
              value={imagePreset}
              onChange={(e) => {
                if (e.target.value !== 'custom') set('image', e.target.value);
              }}
            >
              <option value="custom">Custom image (input manual)</option>
              {IMAGE_PRESETS.map((image) => (
                <option key={image} value={image}>
                  {image}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Docker image" hint="Mengganti image perlu reinstall agar diterapkan." required>
            <Input
              value={form.image}
              onChange={(e) => set('image', e.target.value)}
              className="font-mono text-xs"
              placeholder="registry/image:tag"
            />
          </Field>

          <Field label="Startup command" required>
            <Textarea
              rows={4}
              required
              value={form.startup}
              onChange={(e) => set('startup', e.target.value)}
              className="font-mono text-xs"
              spellCheck={false}
            />
          </Field>
          <div className="-mt-2 rounded-lg border border-line-soft bg-base-900/70 px-3 py-2.5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Preview command (variable substitution)
            </p>
            <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-emerald-300">
              {startupPreview || '—'}
            </pre>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-ink-muted">Environment variables</p>
                <p className="mt-0.5 text-[11px] text-ink-faint">Simpan sebagai object JSON di konfigurasi server.</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => setEnvRows((rows) => [...rows, { id: crypto.randomUUID(), key: '', value: '' }])}
              >
                + Tambah variabel
              </Button>
            </div>
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full table-fixed text-left text-xs">
                <thead className="bg-base-800 text-[10px] uppercase tracking-wide text-ink-faint">
                  <tr>
                    <th className="w-[34%] px-2.5 py-2 md:px-3">Key</th>
                    <th className="px-2.5 py-2 md:px-3">Value</th>
                    <th className="w-12 px-1 py-2 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {envRows.map((row) => (
                    <tr key={row.id} className="border-t border-line-soft">
                      <td className="px-2 py-2 md:px-3">
                        <Input
                          value={row.key}
                          onChange={(e) =>
                            setEnvRows((rows) => rows.map((current) => current.id === row.id ? { ...current, key: e.target.value } : current))
                          }
                          placeholder="KEY"
                          className="h-9 px-2 font-mono text-[11px]"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          aria-label="Environment variable key"
                        />
                      </td>
                      <td className="px-2 py-2 md:px-3">
                        <Input
                          value={row.value}
                          onChange={(e) =>
                            setEnvRows((rows) => rows.map((current) => current.id === row.id ? { ...current, value: e.target.value } : current))
                          }
                          placeholder="value"
                          className="h-9 px-2 font-mono text-[11px]"
                          autoCapitalize="off"
                          autoCorrect="off"
                          spellCheck={false}
                          aria-label={`Value untuk ${row.key || 'environment variable'}`}
                        />
                      </td>
                      <td className="px-1 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => setEnvRows((rows) => rows.filter((current) => current.id !== row.id))}
                          className="rounded p-2 text-ink-faint transition-colors hover:bg-red-500/10 hover:text-red-400"
                          aria-label={`Hapus ${row.key || 'environment variable'}`}
                          title="Hapus variabel"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                  {envRows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-5 text-center text-xs text-ink-faint">
                        Belum ada environment variable. Tambahkan baris untuk mulai mengedit.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {message && (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
              {message}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2 md:flex-row md:justify-end">
            <Button size="sm" variant="secondary" onClick={save} loading={saving}>
              Simpan
            </Button>
            <Button size="sm" variant="secondary" onClick={() => openReinstall(true)} disabled={saving || busy}>
              Simpan & Reinstall
            </Button>
            <Button size="sm" onClick={() => openReinstall(false)} disabled={saving || busy}>
              Reinstall
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Port Tambahan" subtitle="Alokasi jaringan lain pada node yang sama" />
        <div className="space-y-4 px-5 py-4">
          {allocationError && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {allocationError}
            </div>
          )}
          {allocationMessage && (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
              {allocationMessage}
            </div>
          )}
          <div className="space-y-2">
            {allocationsLoading ? (
              <p className="text-xs text-ink-faint">Memuat alokasi…</p>
            ) : allocations.length === 0 ? (
              <p className="text-xs text-ink-faint">Belum ada port yang di-assign ke server ini.</p>
            ) : (
              allocations.map((allocation) => (
                <div
                  key={allocation.id}
                  className="flex items-center gap-3 rounded-lg border border-line-soft bg-base-900/50 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 font-mono text-xs text-ink">{displayAllocation(allocation)}</span>
                  {allocation.is_primary ? (
                    <span className="rounded bg-accent-soft px-2 py-1 text-[10px] font-medium text-accent">Port utama</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void removeAllocation(allocation.id)}
                      disabled={allocationBusy}
                      className="rounded-md border border-red-500/25 px-2.5 py-1 text-xs text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                      title="Lepas port tambahan"
                    >
                      Hapus
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex flex-col gap-2 md:flex-row">
            <Select
              value={selectedAllocation}
              onChange={(e) => setSelectedAllocation(e.target.value)}
              disabled={allocationsLoading || availableAllocations.length === 0 || allocationBusy}
              aria-label="Pilih port tambahan"
            >
              <option value="">
                {availableAllocations.length === 0 ? 'Tidak ada port tersedia' : 'Pilih port yang tersedia…'}
              </option>
              {availableAllocations.map((allocation) => (
                <option key={allocation.id} value={allocation.id}>
                  {displayAllocation(allocation)}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={() => void addAllocation()}
              loading={allocationBusy}
              disabled={!selectedAllocation || allocationsLoading}
            >
              + Tambah Port
            </Button>
          </div>
          <p className="text-[11px] text-ink-faint">
            Port yang sedang digunakan server lain tidak akan muncul. Port utama tidak dapat dilepas. Daftar port bebas
            dikelola di halaman node →{' '}
            <Link
              href={`/nodes/${server.node_id}`}
              className="font-medium text-accent transition-colors hover:text-accent-dim"
            >
              Allocations / Port
            </Link>
            .
          </p>
        </div>
      </Card>

      {isAdmin && (
        <Card className="border-red-500/20">
          <CardHeader title="Zona berbahaya" subtitle="Aksi admin — pastikan Anda memahami dampaknya" />
          <div className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{server.is_suspended ? 'Unsuspend server' : 'Suspend server'}</p>
                <p className="text-xs text-ink-faint">Server yang disuspend tidak dapat dijalankan siapapun.</p>
              </div>
              <Button size="sm" variant="secondary" onClick={toggleSuspend} loading={saving}>
                {server.is_suspended ? 'Unsuspend' : 'Suspend'}
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
              <div>
                <p className="text-sm font-medium text-red-400">Hapus server</p>
                <p className="text-xs text-ink-faint">
                  Hapus record panel dan lepaskan semua port. Data di node hanya dihapus jika opsi dipilih.
                </p>
              </div>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setError(null);
                  setDeleteTyped('');
                  setDeleteDataOnNode(false);
                  setDeleteOpen(true);
                }}
              >
                Hapus server…
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDangerModal
        open={reinstallOpen}
        onClose={() => {
          if (!busy) {
            setReinstallOpen(false);
            setReinstallTyped('');
          }
        }}
        onConfirm={() => void confirmReinstall()}
        title={reinstallSaveFirst ? 'Simpan & reinstall server?' : 'Reinstall server?'}
        description={
          <>
            Server akan diinstall ulang. World dan plugin tetap aman, hanya server jar yang akan didownload ulang sesuai konfigurasi startup. Lanjutkan?
            {error && <p className="mt-2 text-xs text-red-200">{error}</p>}
          </>
        }
        confirmText={reinstallSaveFirst ? form.name.trim() : server.name}
        typedValue={reinstallTyped}
        setTypedValue={setReinstallTyped}
        loading={busy}
        dangerLabel={reinstallSaveFirst ? 'Simpan & Reinstall' : 'Reinstall'}
      />

      <Modal
        open={deleteOpen}
        onClose={() => {
          if (!busy) setDeleteOpen(false);
        }}
        title="Hapus server?"
      >
        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-300">
            <p>
              Server <strong>{server.name}</strong> akan dihapus dari panel. Server users, backup, activity log, dan
              assignment port akan dibersihkan.
            </p>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-red-500/20 bg-base-900/60 px-3 py-2.5 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={deleteDataOnNode}
                onChange={(e) => setDeleteDataOnNode(e.target.checked)}
                className="mt-0.5 accent-red-500"
              />
              <span>
                <strong className="text-red-300">Hapus data di node (world, plugin, semua file)</strong>
                <span className="mt-1 block text-ink-faint">
                  Jika tidak dicentang, container dan seluruh file di Wings tetap ada; hanya record panel yang dihapus.
                </span>
              </span>
            </label>
          </div>

          <div>
            <label className="mb-1.5 block text-xs text-ink-muted">
              Ketik <code className="rounded bg-base-600 px-1.5 py-0.5 font-mono text-[11px] text-red-300">{server.name}</code> untuk konfirmasi
            </label>
            <Input
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.target.value)}
              placeholder={server.name}
              autoComplete="off"
              className="font-mono"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>
          )}
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={busy}>
              Batal
            </Button>
            <Button
              variant="danger"
              onClick={() => void deleteServer()}
              loading={busy}
              disabled={deleteTyped !== server.name}
            >
              {deleteDataOnNode ? 'Hapus panel + node' : 'Hapus dari panel saja'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
