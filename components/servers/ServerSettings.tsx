'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Field, Textarea } from '@/components/ui/Input';
import { ConfirmDangerModal } from '@/components/ui/Modal';
import type { ServerRow } from '@/types';

export function ServerSettings({
  server,
  isAdmin,
}: {
  server: ServerRow;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: server.name,
    memory_mb: server.memory_mb,
    cpu_limit: server.cpu_limit,
    startup: server.startup,
    image: server.image,
    envText: Object.entries(server.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [destroyOpen, setDestroyOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function parseEnv(): Record<string, string> | null {
    const env: Record<string, string> = {};
    for (const rawLine of form.envText.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx <= 0) {
        setError(`Baris env tidak valid: "${line}" (format KEY=value)`);
        return null;
      }
      env[line.slice(0, idx).trim()] = line.slice(idx + 1);
    }
    return env;
  }

  async function save() {
    const env = parseEnv();
    if (!env) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${server.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          memory_mb: Number(form.memory_mb),
          cpu_limit: Number(form.cpu_limit),
          startup: form.startup,
          image: form.image,
          env,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan');
      setMessage('Konfigurasi tersimpan. Perubahan build diterapkan saat server restart (wings sync).');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setSaving(false);
    }
  }

  async function toggleSuspend() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/servers/${server.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_suspended: !server.is_suspended }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal');
      setMessage(server.is_suspended ? 'Server di-unsuspend.' : 'Server disuspend.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setSaving(false);
    }
  }

  async function deleteServer(destroy: boolean) {
    setBusy(true);
    setError(null);
    try {
      const url = destroy
        ? `/api/servers/${server.id}?destroy=true&confirm=${encodeURIComponent(server.name)}`
        : `/api/servers/${server.id}`;
      const res = await fetch(url, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menghapus');
      router.replace('/servers');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-4xl gap-4">
      <Card>
        <CardHeader title="Konfigurasi server" subtitle="Tersimpan di database panel · disinkronkan ke wings via Remote API" />
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nama server" required>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Docker image" required>
              <Input value={form.image} onChange={(e) => set('image', e.target.value)} className="font-mono text-xs" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
          <Field label="Startup command" required>
            <Textarea rows={4} value={form.startup} onChange={(e) => set('startup', e.target.value)} className="font-mono text-xs" />
          </Field>
          <Field label="Environment variables" hint="Format KEY=value, satu per baris">
            <Textarea rows={8} value={form.envText} onChange={(e) => set('envText', e.target.value)} className="font-mono text-xs" spellCheck={false} />
          </Field>

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

          <div className="flex justify-end">
            <Button size="sm" onClick={save} loading={saving}>
              Simpan perubahan
            </Button>
          </div>
        </div>
      </Card>

      {isAdmin && (
        <Card className="border-red-500/20">
          <CardHeader title="Zona berbahaya" subtitle="Aksi irreversible — baca baik-baik" />
          <div className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{server.is_suspended ? 'Unsuspend server' : 'Suspend server'}</p>
                <p className="text-xs text-ink-faint">
                  Server disuspend tidak dapat dijalankan siapapun.
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={toggleSuspend} loading={saving}>
                {server.is_suspended ? 'Unsuspend' : 'Suspend'}
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
              <div>
                <p className="text-sm font-medium">Hapus dari panel saja</p>
                <p className="text-xs text-ink-faint">
                  Record dihapus dari database panel. Container + data di node TIDAK disentuh.
                </p>
              </div>
              <Button size="sm" variant="danger" onClick={() => { setTyped(''); setUnlinkOpen(true); }}>
                Hapus dari panel
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
              <div>
                <p className="text-sm font-medium text-red-400">Hapus server + data di node</p>
                <p className="text-xs text-ink-faint">
                  Wings MENGHAPUS container beserta seluruh volume data di /var/lib/pterodactyl/volumes.
                  Ini memenuhi syarat konfirmasi ganda.
                </p>
              </div>
              <Button size="sm" variant="danger" onClick={() => { setTyped(''); setDestroyOpen(true); }}>
                Hapus permanen
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDangerModal
        open={unlinkOpen}
        onClose={() => setUnlinkOpen(false)}
        onConfirm={() => deleteServer(false)}
        title="Hapus dari panel?"
        description={
          <>
            Server <strong>{server.name}</strong> dihapus dari database panel. Data di node tetap utuh
            dan bisa didaftarkan ulang dengan UUID yang sama.
          </>
        }
        confirmText={server.name}
        typedValue={typed}
        setTypedValue={setTyped}
        loading={busy}
        dangerLabel="Hapus dari panel"
      />

      <ConfirmDangerModal
        open={destroyOpen}
        onClose={() => setDestroyOpen(false)}
        onConfirm={() => deleteServer(true)}
        title="HAPUS PERMANEN — server + semua data"
        description={
          <>
            Ini akan memanggil <code className="font-mono">DELETE /api/servers/{server.uuid}</code> di Wings:
            container dihancurkan dan <strong>seluruh folder volume dihapus dari node</strong>.
            Tidak ada jalan kembali.
          </>
        }
        confirmText={server.name}
        typedValue={typed}
        setTypedValue={setTyped}
        loading={busy}
        dangerLabel="Saya paham — hapus semuanya"
      />
    </div>
  );
}
