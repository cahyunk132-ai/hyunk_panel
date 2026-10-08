'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import {
  DEFAULT_DOWNLOAD_FILENAME,
  DOWNLOAD_PROVIDERS,
  DOWNLOAD_PROVIDER_LABELS,
  type DownloadProvider,
} from '@/lib/eggs/download-providers';
import { formatBytes } from '@/lib/utils/format';

interface EggVersion {
  id: string;
  egg_id: string;
  name: string;
  minecraft_version: string | null;
  docker_image: string | null;
  env_overrides: Record<string, unknown>;
  is_recommended: boolean;
  sort_order: number;
  download_provider?: DownloadProvider | null;
  download_url_template?: string | null;
  download_variables?: Record<string, unknown> | null;
  download_filename?: string | null;
  download_executable?: boolean | null;
}

interface EggItem {
  id: string;
  name: string;
  description: string | null;
  docker_image: string;
  startup: string;
  config_stop: string | null;
  config_startup: Record<string, unknown>;
  env_variables: unknown[];
  features: string[];
  created_at: string;
  versions_count: number;
  node_ids: string[];
  versions?: EggVersion[];
}

interface NodeItem {
  id: string;
  name: string;
  fqdn?: string;
}

interface EggForm {
  id: string | null;
  name: string;
  description: string;
  docker_image: string;
  startup: string;
  config_stop: string;
  config_startup: string;
  env_variables: string;
  features: string;
  node_ids: string[];
}

interface DownloadVariableRow {
  key: string;
  value: string;
}

interface VersionForm {
  name: string;
  minecraft_version: string;
  docker_image: string;
  env_overrides: string;
  is_recommended: boolean;
  sort_order: number;
  download_provider: DownloadProvider;
  download_build: string;
  download_url_template: string;
  download_variables: DownloadVariableRow[];
  download_filename: string;
  download_executable: boolean;
}

interface DownloadTestResult {
  loading: boolean;
  url?: string;
  filename?: string;
  size?: number | null;
  error?: string | null;
}

const EMPTY_EGG_FORM: EggForm = {
  id: null,
  name: '',
  description: '',
  docker_image: '',
  startup: '',
  config_stop: 'stop',
  config_startup: '{}',
  env_variables: '[]',
  features: '',
  node_ids: [],
};

const EMPTY_VERSION_FORM: VersionForm = {
  name: '',
  minecraft_version: '',
  docker_image: '',
  env_overrides: '{}',
  is_recommended: false,
  sort_order: 0,
  download_provider: 'none',
  download_build: 'latest',
  download_url_template: '',
  download_variables: [],
  download_filename: 'server.jar',
  download_executable: false,
};

const EMPTY_DOWNLOAD_TEST: DownloadTestResult = { loading: false };

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} harus berisi JSON valid.`);
  }
}

function responseError(json: unknown, fallback: string): string {
  if (json && typeof json === 'object' && 'error' in json && typeof json.error === 'string') return json.error;
  return fallback;
}

export function EggManager() {
  const [eggs, setEggs] = useState<EggItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [eggModalOpen, setEggModalOpen] = useState(false);
  const [eggForm, setEggForm] = useState<EggForm>(EMPTY_EGG_FORM);
  const [versionsEgg, setVersionsEgg] = useState<EggItem | null>(null);
  const [versions, setVersions] = useState<EggVersion[]>([]);
  const [versionForm, setVersionForm] = useState<VersionForm>(EMPTY_VERSION_FORM);
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [downloadTest, setDownloadTest] = useState<DownloadTestResult>(EMPTY_DOWNLOAD_TEST);

  const loadEggs = useCallback(async () => {
    const response = await fetch('/api/admin/eggs', { cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(responseError(json, 'Gagal memuat Egg.'));
    setEggs(Array.isArray(json.eggs) ? (json.eggs as EggItem[]) : []);
  }, []);

  const loadNodes = useCallback(async () => {
    const response = await fetch('/api/nodes', { cache: 'no-store' });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(responseError(json, 'Gagal memuat node.'));
    setNodes(Array.isArray(json.nodes) ? (json.nodes as NodeItem[]) : []);
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      await Promise.all([loadEggs(), loadNodes()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat Egg Manager.');
    } finally {
      setLoading(false);
    }
  }, [loadEggs, loadNodes]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreate() {
    setError(null);
    setEggForm(EMPTY_EGG_FORM);
    setEggModalOpen(true);
  }

  function openEdit(egg: EggItem) {
    setError(null);
    setEggForm({
      id: egg.id,
      name: egg.name,
      description: egg.description ?? '',
      docker_image: egg.docker_image,
      startup: egg.startup,
      config_stop: egg.config_stop ?? 'stop',
      config_startup: JSON.stringify(egg.config_startup ?? {}, null, 2),
      env_variables: JSON.stringify(egg.env_variables ?? [], null, 2),
      features: (egg.features ?? []).join(', '),
      node_ids: [...(egg.node_ids ?? [])],
    });
    setEggModalOpen(true);
  }

  function setEggField<K extends keyof EggForm>(key: K, value: EggForm[K]) {
    setEggForm((current) => ({ ...current, [key]: value }));
  }

  function toggleNode(nodeId: string) {
    setEggForm((current) => ({
      ...current,
      node_ids: current.node_ids.includes(nodeId)
        ? current.node_ids.filter((id) => id !== nodeId)
        : [...current.node_ids, nodeId],
    }));
  }

  async function saveEgg(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        name: eggForm.name,
        description: eggForm.description || null,
        docker_image: eggForm.docker_image,
        startup: eggForm.startup,
        config_stop: eggForm.config_stop,
        config_startup: parseJson(eggForm.config_startup, 'config_startup'),
        env_variables: parseJson(eggForm.env_variables, 'env_variables'),
        features: eggForm.features.split(',').map((feature) => feature.trim()).filter(Boolean),
        node_ids: eggForm.node_ids,
      };
      const response = await fetch(eggForm.id ? `/api/admin/eggs/${eggForm.id}` : '/api/admin/eggs', {
        method: eggForm.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(json, 'Gagal menyimpan Egg.'));
      setEggModalOpen(false);
      setMessage(eggForm.id ? 'Egg berhasil diperbarui.' : 'Egg berhasil dibuat.');
      await loadEggs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan Egg.');
    } finally {
      setBusy(false);
    }
  }

  async function importEgg(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/admin/eggs/import', { method: 'POST', body: formData });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(json, 'Import Egg gagal.'));
      const imported = json.egg as EggItem | undefined;
      setMessage(`Egg${imported?.name ? ` “${imported.name}”` : ''} berhasil di-import beserta versi Docker.`);
      await loadEggs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import Egg gagal.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteEgg(egg: EggItem) {
    if (!window.confirm(`Hapus Egg “${egg.name}” dan semua versinya? Server yang sudah memakai konfigurasi ini tidak akan diubah.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/eggs/${egg.id}`, { method: 'DELETE' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(json, 'Gagal menghapus Egg.'));
      setMessage(`Egg “${egg.name}” berhasil dihapus.`);
      await loadEggs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus Egg.');
    } finally {
      setBusy(false);
    }
  }

  async function openVersions(egg: EggItem) {
    setVersionsEgg(egg);
    setVersions([]);
    setVersionForm(EMPTY_VERSION_FORM);
    setEditingVersionId(null);
    setDownloadTest(EMPTY_DOWNLOAD_TEST);
    setError(null);
    setVersionLoading(true);
    try {
      const response = await fetch(`/api/admin/eggs/${egg.id}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(json, 'Gagal memuat versi Egg.'));
      const detail = json.egg as EggItem;
      setVersions(detail.versions ?? []);
      setVersionsEgg(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat versi Egg.');
    } finally {
      setVersionLoading(false);
    }
  }

  function editVersion(version: EggVersion) {
    setEditingVersionId(version.id);
    const variables = (version.download_variables ?? {}) as Record<string, unknown>;
    const buildValue = typeof variables.BUILD === 'string' ? variables.BUILD : 'latest';
    const extraVariables = Object.entries(variables)
      .filter(([key]) => key !== 'BUILD')
      .map(([key, value]) => ({ key, value: String(value) }));
    setVersionForm({
      name: version.name,
      minecraft_version: version.minecraft_version ?? '',
      docker_image: version.docker_image ?? '',
      env_overrides: JSON.stringify(version.env_overrides ?? {}, null, 2),
      is_recommended: version.is_recommended,
      sort_order: version.sort_order,
      download_provider: version.download_provider ?? 'none',
      download_build: buildValue,
      download_url_template: version.download_url_template ?? '',
      download_variables: extraVariables,
      download_filename:
        version.download_filename ?? DEFAULT_DOWNLOAD_FILENAME[version.download_provider ?? 'none'],
      download_executable: Boolean(version.download_executable),
    });
    setDownloadTest(EMPTY_DOWNLOAD_TEST);
  }

  function resetVersionForm() {
    setEditingVersionId(null);
    setVersionForm(EMPTY_VERSION_FORM);
    setDownloadTest(EMPTY_DOWNLOAD_TEST);
  }

  function changeDownloadProvider(provider: DownloadProvider) {
    setDownloadTest(EMPTY_DOWNLOAD_TEST);
    setVersionForm((current) => {
      // Pertahankan filename custom; ganti bila masih memakai default provider sebelumnya.
      const previousDefault = DEFAULT_DOWNLOAD_FILENAME[current.download_provider];
      const keepFilename =
        current.download_filename.trim() !== '' && current.download_filename !== previousDefault;
      return {
        ...current,
        download_provider: provider,
        download_filename: keepFilename
          ? current.download_filename
          : DEFAULT_DOWNLOAD_FILENAME[provider],
      };
    });
  }

  function setDownloadVariableRow(index: number, field: 'key' | 'value', text: string) {
    setDownloadTest(EMPTY_DOWNLOAD_TEST);
    setVersionForm((current) => ({
      ...current,
      download_variables: current.download_variables.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: text } : row,
      ),
    }));
  }

  function addDownloadVariableRow() {
    setVersionForm((current) => ({
      ...current,
      download_variables: [...current.download_variables, { key: '', value: '' }],
    }));
  }

  function removeDownloadVariableRow(index: number) {
    setVersionForm((current) => ({
      ...current,
      download_variables: current.download_variables.filter((_, rowIndex) => rowIndex !== index),
    }));
  }

  function buildDownloadVariables(): Record<string, string> {
    const variables: Record<string, string> = {};
    for (const row of versionForm.download_variables) {
      const key = row.key.trim();
      if (key) variables[key] = row.value;
    }
    // BUILD disimpan di download_variables (tidak ada kolom terpisah) — hanya
    // untuk provider built-in; custom memakai tabel variabel langsung.
    if (versionForm.download_provider !== 'none' && versionForm.download_provider !== 'custom') {
      variables.BUILD = versionForm.download_build.trim() || 'latest';
    }
    return variables;
  }

  function buildVersionPayload() {
    const provider = versionForm.download_provider;
    return {
      name: versionForm.name,
      minecraft_version: versionForm.minecraft_version || null,
      docker_image: versionForm.docker_image || null,
      env_overrides: parseJson(versionForm.env_overrides, 'env_overrides'),
      is_recommended: versionForm.is_recommended,
      sort_order: Number(versionForm.sort_order),
      download_provider: provider,
      download_url_template: provider === 'custom' ? versionForm.download_url_template.trim() || null : null,
      download_variables: buildDownloadVariables(),
      download_filename:
        provider === 'none' ? null : versionForm.download_filename.trim() || null,
      download_executable: provider !== 'none' && versionForm.download_executable,
    };
  }

  async function testDownloadUrl() {
    setError(null);
    setDownloadTest({ loading: true });
    try {
      const provider = versionForm.download_provider;
      const query = new URLSearchParams({ provider });
      if (versionForm.minecraft_version.trim()) {
        query.set('minecraft_version', versionForm.minecraft_version.trim());
      }
      if (provider !== 'custom' && versionForm.download_build.trim()) {
        query.set('build', versionForm.download_build.trim());
      }
      if (provider === 'custom') {
        query.set('url_template', versionForm.download_url_template);
        query.set('variables', JSON.stringify(buildDownloadVariables()));
      }
      if (versionForm.download_filename.trim()) {
        query.set('filename', versionForm.download_filename.trim());
      }
      query.set('executable', String(versionForm.download_executable));
      const response = await fetch(`/api/download/resolve?${query.toString()}`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        throw new Error(responseError(json, `Test URL gagal (${response.status}).`));
      }
      setDownloadTest({ loading: false, url: json.url, filename: json.filename, size: json.size ?? null });
    } catch (err) {
      setDownloadTest({
        loading: false,
        error: err instanceof Error ? err.message : 'Test URL gagal.',
      });
    }
  }

  async function saveVersion(event: FormEvent) {
    event.preventDefault();
    if (!versionsEgg) return;
    setBusy(true);
    setError(null);
    try {
      const payload = buildVersionPayload();
      const url = editingVersionId
        ? `/api/admin/eggs/${versionsEgg.id}/versions/${editingVersionId}`
        : `/api/admin/eggs/${versionsEgg.id}/versions`;
      const response = await fetch(url, {
        method: editingVersionId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(json, 'Gagal menyimpan versi.'));
      resetVersionForm();
      await openVersions(versionsEgg);
      await loadEggs();
      setMessage('Versi Egg berhasil disimpan.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan versi.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteVersion(version: EggVersion) {
    if (!versionsEgg || !window.confirm(`Hapus versi “${version.name}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/eggs/${versionsEgg.id}/versions/${version.id}`, { method: 'DELETE' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseError(json, 'Gagal menghapus versi.'));
      if (editingVersionId === version.id) resetVersionForm();
      await openVersions(versionsEgg);
      await loadEggs();
      setMessage(`Versi “${version.name}” berhasil dihapus.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus versi.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoader label="Memuat Egg Manager…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Egg Manager</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Kelola template startup, Docker image, environment variable, versi, dan node yang dapat memakai Egg.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`inline-flex cursor-pointer items-center justify-center rounded-lg border border-line bg-base-600 px-3 py-2 text-sm text-ink transition-colors hover:bg-base-700 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            Import Pterodactyl JSON
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                void importEgg(file);
              }}
            />
          </label>
          <Button onClick={openCreate} disabled={busy}>+ Egg manual</Button>
        </div>
      </div>

      {(error || message) && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${error ? 'border-red-500/25 bg-red-500/5 text-red-300' : 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300'}`}>
          {error ?? message}
          {error && <button className="ml-3 text-xs underline" onClick={() => setError(null)}>Tutup</button>}
        </div>
      )}

      {eggs.length === 0 ? (
        <Card className="border-dashed">
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-accent/20 bg-accent-soft text-xl text-accent">◇</div>
            <p className="text-sm font-semibold text-ink">Belum ada Egg</p>
            <p className="mt-1 text-xs text-ink-muted">Buat Egg manual atau import file JSON dari Pterodactyl.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button size="sm" onClick={openCreate}>Buat Egg</Button>
              <Button size="sm" variant="secondary" onClick={() => void refresh()}>Refresh</Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {eggs.map((egg) => (
            <Card key={egg.id} className="flex min-h-[250px] flex-col">
              <div className="flex-1 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-ink">{egg.name}</h2>
                    <p className="mt-1 line-clamp-2 min-h-8 text-xs text-ink-muted">{egg.description || 'Tidak ada deskripsi.'}</p>
                  </div>
                  <Badge tone="accent">{egg.versions_count} versi</Badge>
                </div>
                <div className="mt-4 rounded-lg border border-line-soft bg-base-900/50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Docker image default</p>
                  <code className="mt-1 block break-all font-mono text-[11px] text-ink-muted">{egg.docker_image}</code>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge tone="gray">{egg.node_ids?.length ?? 0} node</Badge>
                  {(egg.features ?? []).slice(0, 3).map((feature) => <Badge key={feature}>{feature}</Badge>)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-line-soft px-5 py-3">
                <Button size="sm" variant="secondary" onClick={() => void openVersions(egg)} disabled={busy}>Versi</Button>
                <Button size="sm" variant="secondary" onClick={() => openEdit(egg)} disabled={busy}>Edit</Button>
                <Button size="sm" variant="danger" onClick={() => void deleteEgg(egg)} disabled={busy}>Hapus</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={eggModalOpen}
        onClose={() => { if (!busy) setEggModalOpen(false); }}
        title={eggForm.id ? `Edit Egg — ${eggForm.name}` : 'Tambah Egg manual'}
        wide
      >
        <form onSubmit={(event) => void saveEgg(event)} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nama" required>
              <Input value={eggForm.name} onChange={(event) => setEggField('name', event.target.value)} required />
            </Field>
            <Field label="Docker image default" required>
              <Input value={eggForm.docker_image} onChange={(event) => setEggField('docker_image', event.target.value)} placeholder="ghcr.io/pterodactyl/yolks:java_21" required />
            </Field>
          </div>
          <Field label="Deskripsi">
            <Textarea value={eggForm.description} onChange={(event) => setEggField('description', event.target.value)} rows={2} />
          </Field>
          <Field label="Startup command" required>
            <Textarea value={eggForm.startup} onChange={(event) => setEggField('startup', event.target.value)} rows={2} className="font-mono text-xs" required />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Stop command">
              <Input value={eggForm.config_stop} onChange={(event) => setEggField('config_stop', event.target.value)} />
            </Field>
            <Field label="Features" hint="Pisahkan dengan koma, misalnya eula, query, console:disable">
              <Input value={eggForm.features} onChange={(event) => setEggField('features', event.target.value)} />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Environment variables (JSON array)" hint={'Format Pterodactyl: [{"name":"Jar","env_variable":"SERVER_JARFILE","default_value":"server.jar"}]'}>
              <Textarea value={eggForm.env_variables} onChange={(event) => setEggField('env_variables', event.target.value)} rows={7} className="font-mono text-[11px]" />
            </Field>
            <Field label="Startup config (JSON object)" hint="Field config.startup dari Egg Pterodactyl.">
              <Textarea value={eggForm.config_startup} onChange={(event) => setEggField('config_startup', event.target.value)} rows={7} className="font-mono text-[11px]" />
            </Field>
          </div>
          <Field label="Assign ke node" hint="Egg hanya akan muncul pada server di node yang dipilih.">
            {nodes.length === 0 ? (
              <p className="rounded-lg border border-line-soft bg-base-900 px-3 py-3 text-xs text-ink-faint">Belum ada node terdaftar.</p>
            ) : (
              <div className="grid max-h-36 gap-2 overflow-y-auto rounded-lg border border-line-soft bg-base-900/50 p-3 sm:grid-cols-2">
                {nodes.map((node) => (
                  <label key={node.id} className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
                    <input type="checkbox" checked={eggForm.node_ids.includes(node.id)} onChange={() => toggleNode(node.id)} className="accent-accent" />
                    <span className="truncate">{node.name}{node.fqdn ? ` · ${node.fqdn}` : ''}</span>
                  </label>
                ))}
              </div>
            )}
          </Field>
          {error && <p className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setEggModalOpen(false)} disabled={busy}>Batal</Button>
            <Button type="submit" loading={busy}>{eggForm.id ? 'Simpan perubahan' : 'Buat Egg'}</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(versionsEgg)}
        onClose={() => { if (!busy) { setVersionsEgg(null); setError(null); } }}
        title={versionsEgg ? `Versi — ${versionsEgg.name}` : 'Versi Egg'}
        wide
      >
        <div className="space-y-5">
          {error && <p className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</p>}
          {versionLoading ? (
            <div className="py-8 text-center text-sm text-ink-faint">Memuat daftar versi…</div>
          ) : (
            <>
              <div className="space-y-2">
                {versions.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-xs text-ink-faint">Belum ada versi khusus. Server akan menggunakan Docker image default Egg.</p>
                ) : versions.map((version) => (
                  <div key={version.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line-soft bg-base-900/40 px-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-ink">{version.name}</span>
                        {version.minecraft_version && <Badge tone="blue">Minecraft {version.minecraft_version}</Badge>}
                        {version.is_recommended && <Badge tone="yellow">★ Recommended</Badge>}
                        {version.download_provider && version.download_provider !== 'none' && (
                          <Badge tone="violet">⬇ {DOWNLOAD_PROVIDER_LABELS[version.download_provider]}</Badge>
                        )}
                      </div>
                      <code className="mt-1 block break-all font-mono text-[10px] text-ink-faint">{version.docker_image || versionsEgg?.docker_image}</code>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => editVersion(version)} disabled={busy}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => void deleteVersion(version)} disabled={busy}>Hapus</Button>
                  </div>
                ))}
              </div>

              <form onSubmit={(event) => void saveVersion(event)} className="space-y-4 rounded-xl border border-line-soft bg-base-900/30 p-4">
                <h3 className="text-sm font-semibold">{editingVersionId ? 'Edit versi' : 'Tambah versi'}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nama versi" required>
                    <Input value={versionForm.name} onChange={(event) => setVersionForm((current) => ({ ...current, name: event.target.value }))} placeholder="1.21.4" required />
                  </Field>
                  <Field label="Minecraft version" hint="Opsional; dipakai sebagai label versi.">
                    <Input value={versionForm.minecraft_version} onChange={(event) => setVersionForm((current) => ({ ...current, minecraft_version: event.target.value }))} placeholder="1.21.4" />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Docker image override" hint="Kosongkan untuk memakai image default Egg.">
                    <Input value={versionForm.docker_image} onChange={(event) => setVersionForm((current) => ({ ...current, docker_image: event.target.value }))} placeholder={versionsEgg?.docker_image} />
                  </Field>
                  <Field label="Urutan">
                    <Input type="number" step={1} value={versionForm.sort_order} onChange={(event) => setVersionForm((current) => ({ ...current, sort_order: Number(event.target.value) }))} />
                  </Field>
                </div>
                <Field label="Environment overrides (JSON object)" hint={'Contoh: {"MINECRAFT_VERSION":"1.21.4","BUILD_NUMBER":"latest"}'}>
                  <Textarea value={versionForm.env_overrides} onChange={(event) => setVersionForm((current) => ({ ...current, env_overrides: event.target.value }))} rows={4} className="font-mono text-[11px]" />
                </Field>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
                  <input type="checkbox" checked={versionForm.is_recommended} onChange={(event) => setVersionForm((current) => ({ ...current, is_recommended: event.target.checked }))} className="accent-accent" />
                  Tandai sebagai recommended (versi rekomendasi tunggal untuk Egg ini)
                </label>

                <div className="space-y-3 rounded-lg border border-line-soft bg-base-900/40 p-3">
                  <Field label="Download Provider" hint="Auto download file server dari provider saat dipasang ke server. Pilih None untuk upload manual.">
                    <Select
                      value={versionForm.download_provider}
                      onChange={(event) => changeDownloadProvider(event.target.value as DownloadProvider)}
                      disabled={busy}
                    >
                      {DOWNLOAD_PROVIDERS.map((provider) => (
                        <option key={provider} value={provider}>
                          {DOWNLOAD_PROVIDER_LABELS[provider]}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {versionForm.download_provider !== 'none' && versionForm.download_provider !== 'custom' && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Build / versi provider" hint="Default latest — di-resolve otomatis dari API provider (Paper/Purpur = nomor build, Forge = latest/recommended/versi, Bedrock = nomor versi).">
                        <Input
                          value={versionForm.download_build}
                          onChange={(event) => {
                            setDownloadTest(EMPTY_DOWNLOAD_TEST);
                            setVersionForm((current) => ({ ...current, download_build: event.target.value }));
                          }}
                          placeholder="latest"
                          disabled={busy}
                        />
                      </Field>
                      <Field label="MC Version" hint="Otomatis memakai field Minecraft version di atas; kosongkan untuk versi terbaru (jika provider mendukung).">
                        <Input value={versionForm.minecraft_version || '(kosong → latest)'} disabled readOnly />
                      </Field>
                    </div>
                  )}

                  {versionForm.download_provider === 'custom' && (
                    <>
                      <Field
                        label="URL Template"
                        hint="Placeholder {KEY} diganti dari tabel variabel + MC_VERSION/BUILD/VERSION. Contoh: https://example.com/download/{VERSION}/{FILE}"
                      >
                        <Textarea
                          value={versionForm.download_url_template}
                          onChange={(event) => {
                            setDownloadTest(EMPTY_DOWNLOAD_TEST);
                            setVersionForm((current) => ({ ...current, download_url_template: event.target.value }));
                          }}
                          rows={2}
                          className="font-mono text-[11px]"
                          placeholder="https://example.com/download/{VERSION}/{FILE}"
                          disabled={busy}
                        />
                      </Field>
                      <Field label="Download variables" hint="Pasangan key-value untuk substitusi template. Nilai boleh literal atau angka versi.">
                        <div className="space-y-2">
                          {versionForm.download_variables.length === 0 && (
                            <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-ink-faint">
                              Belum ada variabel. MC_VERSION, VERSION, dan BUILD tersedia otomatis.
                            </p>
                          )}
                          {versionForm.download_variables.map((row, index) => (
                            <div key={index} className="flex items-center gap-2">
                              <Input
                                value={row.key}
                                onChange={(event) => setDownloadVariableRow(index, 'key', event.target.value)}
                                placeholder="KEY"
                                className="font-mono text-[11px] uppercase"
                                disabled={busy}
                              />
                              <span className="text-ink-faint">=</span>
                              <Input
                                value={row.value}
                                onChange={(event) => setDownloadVariableRow(index, 'value', event.target.value)}
                                placeholder="value"
                                className="font-mono text-[11px]"
                                disabled={busy}
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => removeDownloadVariableRow(index)}
                                disabled={busy}
                                aria-label="Hapus variabel"
                              >
                                ✕
                              </Button>
                            </div>
                          ))}
                          <Button type="button" size="sm" variant="secondary" onClick={addDownloadVariableRow} disabled={busy}>
                            + Variabel
                          </Button>
                        </div>
                      </Field>
                    </>
                  )}

                  {versionForm.download_provider !== 'none' && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Download Filename" hint="Nama file yang disimpan di root server. Default: server.jar (bedrock-server.zip untuk Bedrock).">
                          <Input
                            value={versionForm.download_filename}
                            onChange={(event) => {
                              setDownloadTest(EMPTY_DOWNLOAD_TEST);
                              setVersionForm((current) => ({ ...current, download_filename: event.target.value }));
                            }}
                            placeholder={DEFAULT_DOWNLOAD_FILENAME[versionForm.download_provider]}
                            disabled={busy}
                          />
                        </Field>
                        <Field label="Executable" hint="chmod +x setelah upload/ekstrak — untuk binary non-jar seperti bedrock_server.">
                          <label className="flex h-9 cursor-pointer items-center gap-2 text-xs text-ink-muted">
                            <input
                              type="checkbox"
                              checked={versionForm.download_executable}
                              onChange={(event) => {
                                setDownloadTest(EMPTY_DOWNLOAD_TEST);
                                setVersionForm((current) => ({ ...current, download_executable: event.target.checked }));
                              }}
                              className="accent-accent"
                              disabled={busy}
                            />
                            Set executable setelah download
                          </label>
                        </Field>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => void testDownloadUrl()} loading={downloadTest.loading} disabled={busy}>
                          Test URL
                        </Button>
                        <p className="text-[11px] text-ink-faint">Resolve template/API provider dan tampilkan URL final sebelum save.</p>
                      </div>
                      {downloadTest.error && (
                        <p className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">{downloadTest.error}</p>
                      )}
                      {downloadTest.url && (
                        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
                          <p className="text-[11px] font-semibold text-emerald-300">✓ URL berhasil di-resolve</p>
                          <code className="mt-1 block break-all font-mono text-[11px] text-emerald-200/90">{downloadTest.url}</code>
                          <p className="mt-1 text-[10px] text-emerald-200/70">
                            {downloadTest.filename}
                            {downloadTest.size != null ? ` · ${formatBytes(downloadTest.size)}` : ''}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {editingVersionId && <Button type="button" size="sm" variant="ghost" onClick={resetVersionForm} disabled={busy}>Batal edit</Button>}
                  <Button type="submit" size="sm" loading={busy}>{editingVersionId ? 'Simpan versi' : 'Tambah versi'}</Button>
                </div>
              </form>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
