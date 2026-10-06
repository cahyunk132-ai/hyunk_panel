'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Field, Textarea, Select } from '@/components/ui/Input';
import { formatAllocation } from '@/lib/utils/allocations';
import type { NodeAllocation } from '@/types';

interface NodeOption {
  id: string;
  name: string;
  fqdn: string;
}

const PRESETS = [
  {
    label: 'Minecraft Java (Paper/Purpur)',
    image: 'ghcr.io/pterodactyl/yolks:java_25',
    startup: 'java -Xms128M -XX:MaxRAMPercentage=95.0 -Dterminal.jline=false -Dterminal.ansi=true -jar {{SERVER_JARFILE}}',
    env: 'SERVER_JARFILE=server.jar\nMINECRAFT_VERSION=latest\nBUILD_NUMBER=latest',
  },
  {
    label: 'Minecraft Bedrock',
    image: 'ghcr.io/ptero-eggs/yolks:debian',
    startup: './bedrock_server',
    env: 'BEDROCK_VERSION=latest\nSERVERNAME=Bedrock Dedicated Server\nDIFFICULTY=normal\nGAMEMODE=survival\nCHEATS=false\nLD_LIBRARY_PATH=.',
  },
  {
    label: 'NodeJS App',
    image: 'ghcr.io/ptero-eggs/yolks:nodejs_25',
    startup:
      'if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; /usr/local/bin/node "/home/container/${MAIN_FILE}" ${NODE_ARGS}',
    env: 'MAIN_FILE=index.js\nNODE_ARGS=\nAUTO_UPDATE=0',
  },
];

export function NewServerForm({ nodes }: { nodes: NodeOption[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    node_id: nodes[0]?.id ?? '',
    allocation_id: '',
    memory_mb: 2048,
    cpu_limit: 100,
    disk_mb: 10240,
    image: PRESETS[0].image,
    startup: PRESETS[0].startup,
    env: PRESETS[0].env,
    provision: false,
  });

  const [allocationOptions, setAllocationOptions] = useState<NodeAllocation[]>([]);
  const [allocationsLoading, setAllocationsLoading] = useState(false);
  const [allocationsError, setAllocationsError] = useState<string | null>(null);

  /** Ambil allocation yang masih bebas (`assigned_to IS NULL`) pada node terpilih. */
  const loadAllocations = useCallback(async (nodeId: string) => {
    if (!nodeId) {
      setAllocationOptions([]);
      return;
    }
    setAllocationsLoading(true);
    setAllocationsError(null);
    try {
      const response = await fetch(`/api/nodes/${nodeId}/allocations?status=available`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal memuat daftar port node');
      const options = Array.isArray(json.allocations) ? (json.allocations as NodeAllocation[]) : [];
      setAllocationOptions(options);
      // Pilih port pertama yang tersedia; pertahankan pilihan lama bila masih valid.
      setForm((f) => ({
        ...f,
        allocation_id: options.some((option) => option.id === f.allocation_id) ? f.allocation_id : (options[0]?.id ?? ''),
      }));
    } catch (err) {
      setAllocationOptions([]);
      setAllocationsError(err instanceof Error ? err.message : 'Gagal memuat daftar port node');
      setForm((f) => ({ ...f, allocation_id: '' }));
    } finally {
      setAllocationsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllocations(form.node_id);
  }, [form.node_id, loadAllocations]);

  function applyPreset(idx: number) {
    const p = PRESETS[idx];
    setForm((f) => ({ ...f, image: p.image, startup: p.startup, env: p.env }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (!Number.isFinite(Number(form.disk_mb)) || Number(form.disk_mb) < 1024) {
        throw new Error('Disk minimal 1024 MB');
      }
      if (!form.allocation_id) {
        throw new Error('Pilih port (allocation) yang tersedia di node ini.');
      }
      const env: Record<string, string> = {};
      for (const rawLine of form.env.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const i = line.indexOf('=');
        if (i <= 0) throw new Error(`Env tidak valid: "${line}"`);
        env[line.slice(0, i).trim()] = line.slice(i + 1);
      }
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          node_id: form.node_id,
          allocation_id: form.allocation_id,
          memory_mb: Number(form.memory_mb),
          cpu_limit: Number(form.cpu_limit),
          disk_mb: Number(form.disk_mb) || 10240,
          image: form.image,
          startup: form.startup,
          env,
          provision: form.provision,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal membuat server');
      if (json.provision_error) {
        setError(
          `Server terdaftar di panel, tapi provisioning node gagal: ${json.provision_error}. Pastikan Remote API (Phase 1b) sudah aktif dan node menunjuk ke panel ini.`,
        );
        router.refresh();
        return;
      }
      router.push(`/servers/${json.server.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader
        title="Server baru"
        subtitle="Panel TIDAK melakukan auto-provisioning kecuali Anda mencentang opsi di bawah — data existing aman"
      />
      <form onSubmit={onSubmit} className="space-y-5 px-5 py-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Nama server" required>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </Field>
          <Field label="Node" required>
            <Select value={form.node_id} onChange={(e) => setForm((f) => ({ ...f, node_id: e.target.value }))}>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.fqdn})
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Port (allocation)" hint="Hanya port yang belum dipakai server lain di node ini." required>
            <Select
              value={form.allocation_id}
              onChange={(e) => setForm((f) => ({ ...f, allocation_id: e.target.value }))}
              disabled={allocationsLoading || allocationOptions.length === 0}
              required
            >
              {allocationOptions.length === 0 ? (
                <option value="">{allocationsLoading ? 'Memuat port…' : 'Tidak ada port tersedia'}</option>
              ) : (
                <>
                  <option value="">Pilih port…</option>
                  {allocationOptions.map((allocation) => (
                    <option key={allocation.id} value={allocation.id}>
                      {formatAllocation(allocation.ip, allocation.port)}
                    </option>
                  ))}
                </>
              )}
            </Select>
          </Field>
          <Field label="Memory (MB)" required>
            <Input
              type="number"
              min={128}
              value={form.memory_mb}
              onChange={(e) => setForm((f) => ({ ...f, memory_mb: Number(e.target.value) }))}
              required
            />
          </Field>
          <Field label="CPU limit (%)" required>
            <Input
              type="number"
              min={25}
              step={25}
              value={form.cpu_limit}
              onChange={(e) => setForm((f) => ({ ...f, cpu_limit: Number(e.target.value) }))}
              required
            />
          </Field>
          <Field label="Disk (MB)" hint="Min. 1024 MB" required>
            <Input
              type="number"
              min={1024}
              step={512}
              value={form.disk_mb}
              onChange={(e) => setForm((f) => ({ ...f, disk_mb: Number(e.target.value) }))}
              required
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-soft bg-base-800/60 px-3 py-2.5 text-[11px] text-ink-faint">
          <span>
            Port diambil dari daftar allocation node — setelah server dibuat, port otomatis ditandai terpakai dan tidak
            bisa dipilih server lain.
          </span>
          <Link
            href={`/nodes/${form.node_id}`}
            className="shrink-0 font-medium text-accent transition-colors hover:text-accent-dim"
          >
            Kelola port di node →
          </Link>
        </div>

        {allocationsError && (
          <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            {allocationsError}
          </div>
        )}
        {!allocationsLoading && !allocationsError && allocationOptions.length === 0 && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            Node ini belum punya port bebas.{' '}
            <Link href={`/nodes/${form.node_id}`} className="font-medium underline">
              Tambahkan range port di halaman node
            </Link>{' '}
            (contoh 25565-25600) sebelum membuat server.
          </div>
        )}

        <Field label="Preset (opsional)">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(i)}
                className="rounded-lg border border-line bg-base-800 px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-accent/40 hover:text-accent"
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Docker image" required>
          <Input
            value={form.image}
            onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))}
            className="font-mono text-xs"
            required
          />
        </Field>

        <Field label="Startup command" required>
          <Textarea
            rows={4}
            value={form.startup}
            onChange={(e) => setForm((f) => ({ ...f, startup: e.target.value }))}
            className="font-mono text-xs"
            required
          />
        </Field>

        <Field label="Environment variables" hint="Format KEY=value, satu per baris">
          <Textarea
            rows={5}
            value={form.env}
            onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
            className="font-mono text-xs"
            spellCheck={false}
          />
        </Field>

        <label className="flex items-start gap-3 rounded-lg border border-line bg-base-800/60 px-4 py-3">
          <input
            type="checkbox"
            checked={form.provision}
            onChange={(e) => setForm((f) => ({ ...f, provision: e.target.checked }))}
            className="mt-1 accent-[#3ecfcf]"
          />
          <span className="text-xs text-ink-muted">
            <strong className="text-ink">Buat container di node sekarang</strong> — memanggil
            POST /api/servers di Wings. Wings akan menarik konfigurasi dari Remote API panel
            (Phase 1b) lalu menjalankan instalasi (no-op, data aman). Butuh node yang sudah
            menunjuk ke panel ini.
          </span>
        </label>

        {error && (
          <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={() => router.back()}>
            Batal
          </Button>
          <Button
            type="submit"
            loading={loading}
            disabled={!form.allocation_id || allocationsLoading}
            title={!form.allocation_id ? 'Pilih port (allocation) terlebih dahulu' : undefined}
          >
            Buat server
          </Button>
        </div>
      </form>
    </Card>
  );
}
