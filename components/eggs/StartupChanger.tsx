'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Field, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { DOWNLOAD_PROVIDER_INFO } from '@/lib/eggs/download-providers';
import { formatBytes } from '@/lib/utils/format';
import type { DownloadProvider } from '@/types';

interface EggVersion {
  id: string;
  egg_id: string;
  name: string;
  minecraft_version: string | null;
  docker_image: string | null;
  env_overrides: Record<string, unknown> | null;
  is_recommended: boolean;
  sort_order: number;
  download_provider?: DownloadProvider | null;
  download_filename?: string | null;
  download_executable?: boolean | null;
}

type DownloadStage = 'idle' | 'resolving' | 'downloading' | 'uploading' | 'finalizing' | 'done' | 'error';

interface DownloadState {
  stage: DownloadStage;
  bytes: number;
  total: number | null;
  filename: string | null;
  url: string | null;
  error: string | null;
  /** Index langkah aktif saat error terjadi (untuk styling ✕). */
  errorIndex?: number;
}

const IDLE_DOWNLOAD: DownloadState = {
  stage: 'idle',
  bytes: 0,
  total: null,
  filename: null,
  url: null,
  error: null,
};

interface EggOption {
  id: string;
  name: string;
  description: string | null;
  docker_image: string;
  startup: string;
  config_stop: string | null;
  config_startup: Record<string, unknown>;
  env_variables: unknown[];
  features: string[];
  versions: EggVersion[];
  available: boolean;
}

interface CurrentEgg {
  egg_id: string | null;
  version_id: string | null;
  egg_name: string | null;
  version_name: string | null;
  image: string;
  startup: string;
}

interface EggResponse {
  can_change: boolean;
  eggs: EggOption[];
  current: CurrentEgg;
  preview_context: Record<string, string>;
}

function defaultEnv(variables: unknown[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of variables) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const variable = raw as Record<string, unknown>;
    const key = variable.env_variable;
    if (typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = variable.default_value == null ? '' : String(variable.default_value);
  }
  return env;
}

function overrideEnv(values: Record<string, unknown> | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = String(value);
    }
  }
  return result;
}

function substituteStartup(startup: string, env: Record<string, string>): string {
  return startup.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(env, key) ? env[key] : placeholder,
  );
}

const STAGE_ORDER: DownloadStage[] = ['resolving', 'downloading', 'uploading', 'finalizing'];

/** Daftar langkah progress auto-download (NDJSON dari /download-server-file). */
function DownloadProgress({ state }: { state: DownloadState }) {
  if (state.stage === 'idle') return null;
  const allDone = state.stage === 'done';
  const current = allDone
    ? STAGE_ORDER.length
    : state.stage === 'error'
      ? (state.errorIndex ?? STAGE_ORDER.length)
      : STAGE_ORDER.indexOf(state.stage);

  const downloadingLabel =
    state.total != null
      ? `Downloading… ${formatBytes(state.bytes)} / ${formatBytes(state.total)}`
      : state.bytes > 0
        ? `Downloading… ${formatBytes(state.bytes)}`
        : 'Downloading…';
  const steps: Array<{ id: DownloadStage; label: string }> = [
    { id: 'resolving', label: 'Resolving URL…' },
    { id: 'downloading', label: downloadingLabel },
    { id: 'uploading', label: 'Uploading ke Wings…' },
    { id: 'finalizing', label: 'Ekstrak & chmod…' },
  ];
  return (
    <div className="space-y-1.5 rounded-lg border border-line-soft bg-base-900/60 px-3 py-3">
      {steps.map((step, index) => {
        const doneStep = allDone || index < current;
        const active = !allDone && state.stage !== 'error' && index === current;
        const failed = state.stage === 'error' && index === current;
        return (
          <div key={step.id} className="flex items-center gap-2 text-[11px]">
            <span
              className={`w-4 text-center ${
                doneStep ? 'text-emerald-400' : failed ? 'text-red-400' : active ? 'text-accent' : 'text-ink-faint'
              }`}
            >
              {doneStep ? '✓' : failed ? '✕' : active ? '…' : '·'}
            </span>
            <span
              className={`${
                doneStep ? 'text-ink-muted' : active ? 'text-ink' : 'text-ink-faint'
              } ${step.id === 'uploading' ? 'hidden sm:inline' : ''}`}
            >
              {step.id === 'downloading' && (state.stage === 'downloading' || allDone)
                ? step.label
                : step.label.replace(/\s+\d.*$/, '').replace(/… .*$/, '…')}
            </span>
          </div>
        );
      })}
      {state.stage === 'done' && (
        <p className="text-[11px] font-medium text-emerald-300">
          Done! {state.filename ?? 'File'} tersimpan di server ({formatBytes(state.bytes)}).
        </p>
      )}
      {state.stage === 'error' && (
        <p className="text-[11px] font-medium text-red-300">✕ {state.error ?? 'Download gagal.'}</p>
      )}
    </div>
  );
}

export function StartupChanger({ serverId }: { serverId: string }) {
  const router = useRouter();
  const [data, setData] = useState<EggResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedEggId, setSelectedEggId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadState>(IDLE_DOWNLOAD);

  const loadEggs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/servers/${serverId}/eggs`, { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal memuat Egg server.');
      const result = json as EggResponse;
      setData(result);

      if (result.can_change) {
        const currentChoice = result.eggs.find((egg) => egg.id === result.current.egg_id);
        const firstAvailable = result.eggs.find((egg) => egg.available);
        const initialEgg = currentChoice ?? firstAvailable;
        setSelectedEggId(initialEgg?.id ?? '');
        if (initialEgg?.id === result.current.egg_id) {
          setSelectedVersionId(result.current.version_id ?? '');
        } else {
          const recommended = initialEgg?.versions.find((version) => version.is_recommended);
          setSelectedVersionId(recommended?.id ?? initialEgg?.versions[0]?.id ?? '');
        }
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Gagal memuat Egg server.');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void loadEggs();
  }, [loadEggs]);

  const selectedEgg = data?.eggs.find((egg) => egg.id === selectedEggId);
  const selectedVersion = selectedEgg?.versions.find((version) => version.id === selectedVersionId);
  const preview = useMemo(() => {
    if (!selectedEgg) return '';
    const env = defaultEnv(selectedEgg.env_variables);
    Object.assign(env, overrideEnv(selectedVersion?.env_overrides));
    if (selectedVersion?.minecraft_version && Object.prototype.hasOwnProperty.call(env, 'MINECRAFT_VERSION')) {
      env.MINECRAFT_VERSION = selectedVersion.minecraft_version;
    }
    Object.assign(env, data?.preview_context ?? {});
    return substituteStartup(selectedEgg.startup, env);
  }, [data?.preview_context, selectedEgg, selectedVersion]);

  const hasUnknownVariables = useMemo(
    () => /\{\{\s*[A-Za-z0-9_]+\s*\}\}/.test(preview),
    [preview],
  );

  const changed = Boolean(
    selectedEgg &&
      (selectedEgg.id !== data?.current.egg_id || (selectedVersionId || null) !== data?.current.version_id),
  );
  const downloadInProgress = ['resolving', 'downloading', 'uploading', 'finalizing'].includes(download.stage);
  const canApply = Boolean(selectedEgg?.available && changed && !busy && !downloadInProgress);
  const targetTitle = selectedEgg
    ? `${selectedEgg.name}${selectedVersion ? ` ${selectedVersion.name}` : ' (default image)'}`
    : 'Egg';

  function changeEgg(eggId: string) {
    setSelectedEggId(eggId);
    setDownload(IDLE_DOWNLOAD);
    const egg = data?.eggs.find((item) => item.id === eggId);
    if (eggId === data?.current.egg_id) {
      setSelectedVersionId(data.current.version_id ?? '');
      return;
    }
    const recommended = egg?.versions.find((version) => version.is_recommended);
    setSelectedVersionId(recommended?.id ?? egg?.versions[0]?.id ?? '');
  }

  function changeVersion(versionId: string) {
    setSelectedVersionId(versionId);
    setDownload(IDLE_DOWNLOAD);
  }

  /**
   * Jalankan auto download untuk satu versi: POST /download-server-file
   * (NDJSON stream) dan perbarui progress di UI. Return true bila sukses.
   */
  async function runDownload(versionId: string): Promise<boolean> {
    setDownload({ ...IDLE_DOWNLOAD, stage: 'resolving' });
    let lastStageIndex = 0;
    try {
      const response = await fetch(`/api/servers/${serverId}/download-server-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ egg_version_id: versionId }),
      });
      if (!response.ok || !response.body) {
        const json = await response.json().catch(() => ({}));
        throw new Error(
          typeof json.error === 'string' ? json.error : `Permintaan download gagal (${response.status}).`,
        );
      }

      let success = false;
      let streamError: string | null = null;
      const handleEvent = (event: Record<string, unknown>) => {
        switch (event.stage) {
          case 'resolving':
            lastStageIndex = 0;
            setDownload((prev) => ({ ...prev, stage: 'resolving' }));
            break;
          case 'resolved':
            lastStageIndex = 1;
            setDownload((prev) => ({
              ...prev,
              stage: 'downloading',
              url: typeof event.url === 'string' ? event.url : prev.url,
              filename: typeof event.filename === 'string' ? event.filename : prev.filename,
              total: typeof event.size === 'number' ? event.size : prev.total,
            }));
            break;
          case 'downloading':
            lastStageIndex = 1;
            setDownload((prev) => ({
              ...prev,
              stage: 'downloading',
              bytes: typeof event.bytes === 'number' ? event.bytes : prev.bytes,
              total: typeof event.total === 'number' ? event.total : prev.total,
            }));
            break;
          case 'uploading':
            lastStageIndex = 2;
            setDownload((prev) => ({
              ...prev,
              stage: 'uploading',
              bytes: typeof event.bytes === 'number' ? event.bytes : prev.bytes,
              total: typeof event.total === 'number' ? event.total : prev.total,
            }));
            break;
          case 'extracting':
          case 'chmod':
            lastStageIndex = 3;
            setDownload((prev) => ({ ...prev, stage: 'finalizing' }));
            break;
          case 'done':
            success = true;
            setDownload((prev) => ({
              ...prev,
              stage: 'done',
              filename: typeof event.filename === 'string' ? event.filename : prev.filename,
              bytes: typeof event.size === 'number' ? event.size : prev.bytes,
            }));
            break;
          case 'error':
            streamError = typeof event.error === 'string' ? event.error : 'Download gagal.';
            break;
        }
      };

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) {
            try {
              handleEvent(JSON.parse(line) as Record<string, unknown>);
            } catch {
              // abaikan baris non-JSON
            }
          }
        }
      }
      const tail = buffer.trim();
      if (tail) {
        try {
          handleEvent(JSON.parse(tail) as Record<string, unknown>);
        } catch {
          // abaikan
        }
      }
      if (!success) {
        throw new Error(
          streamError ?? 'Koneksi terputus sebelum download selesai (file besar melebihi batas waktu platform?).',
        );
      }
      return true;
    } catch (err) {
      setDownload((prev) => ({
        ...prev,
        stage: 'error',
        errorIndex: lastStageIndex,
        error: err instanceof Error ? err.message : 'Download gagal.',
      }));
      return false;
    }
  }

  async function applyChange() {
    if (!selectedEgg || !selectedEgg.available) return;
    setBusy(true);
    setError(null);
    try {
      // Flow: auto download dulu (resolve → download → upload → chmod),
      // baru simpan konfigurasi + trigger reinstall Wings.
      if (selectedVersion && selectedVersion.download_provider && selectedVersion.download_provider !== 'none') {
        const downloaded = await runDownload(selectedVersion.id);
        if (!downloaded) {
          setError('Auto download gagal — konfigurasi belum disimpan dan reinstall dibatalkan.');
          return;
        }
      }
      const response = await fetch(`/api/servers/${serverId}/startup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          egg_id: selectedEgg.id,
          version_id: selectedVersionId || null,
          confirm: true,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Gagal menyimpan Egg dan memulai reinstall.');
      setConfirmOpen(false);
      router.replace(`/servers/${serverId}/console`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan Egg dan memulai reinstall.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageLoader label="Memuat Egg dan versi…" />;

  if (loadError || !data) {
    return (
      <Card className="border-red-500/20 px-5 py-4">
        <p className="text-sm font-medium text-red-300">Gagal memuat Startup</p>
        <p className="mt-1 text-xs text-red-200/80">{loadError ?? 'Data Egg tidak tersedia.'}</p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => void loadEggs()}>
          Coba lagi
        </Button>
      </Card>
    );
  }

  if (!data.can_change) {
    return (
      <Card>
        <CardHeader title="Startup" subtitle="Egg dan versi yang sedang digunakan server ini" />
        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line-soft bg-base-900/50 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Egg</p>
              <p className="mt-1 text-sm font-medium text-ink">{data.current.egg_name ?? 'Egg tidak terdaftar'}</p>
            </div>
            <div className="rounded-lg border border-line-soft bg-base-900/50 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Versi</p>
              <p className="mt-1 text-sm font-medium text-ink">{data.current.version_name ?? 'Versi default / tidak ditetapkan'}</p>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Docker image</p>
            <code className="block break-all rounded-lg border border-line-soft bg-base-900 px-3 py-2 font-mono text-xs text-ink-muted">
              {data.current.image}
            </code>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Startup command</p>
            <code className="block overflow-x-auto rounded-lg border border-line-soft bg-base-900 px-3 py-2 font-mono text-xs text-ink-muted">
              {data.current.startup}
            </code>
          </div>
          <p className="text-[11px] text-ink-faint">Akun Anda hanya dapat melihat konfigurasi Egg dan versi saat ini.</p>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Startup"
          subtitle="Pilih Egg dan versi Docker untuk server ini. Perubahan akan memulai reinstall."
          action={<Badge tone="accent">Egg system</Badge>}
        />
        <div className="space-y-4 px-5 py-4">
          {data.eggs.filter((egg) => egg.available).length === 0 && (
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
              Belum ada Egg yang di-assign ke node ini. Minta Owner Panel/Admin memilih Egg dari Egg Manager.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Egg">
              <Select
                value={selectedEggId}
                onChange={(event) => changeEgg(event.target.value)}
                disabled={data.eggs.filter((egg) => egg.available).length === 0 || busy}
              >
                {!selectedEggId && <option value="">Tidak ada Egg tersedia pada node</option>}
                {data.eggs.map((egg) => (
                  <option key={egg.id} value={egg.id} disabled={!egg.available}>
                    {egg.name}{!egg.available ? ' (tidak lagi tersedia di node)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Versi">
              <Select
                value={selectedVersionId}
                onChange={(event) => changeVersion(event.target.value)}
                disabled={!selectedEgg || selectedEgg.versions.length === 0 || busy}
              >
                <option value="">Default Egg image</option>
                {(selectedEgg?.versions ?? []).map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.is_recommended ? '★ ' : ''}
                    {version.name}
                    {version.minecraft_version ? ` · Minecraft ${version.minecraft_version}` : ''}
                    {version.is_recommended ? ' · Recommended' : ''}
                  </option>
                ))}
              </Select>
              {selectedEgg?.versions.length === 0 && (
                <p className="mt-1 text-[11px] text-ink-faint">Egg ini belum memiliki versi khusus; image dasar akan digunakan.</p>
              )}
            </Field>
          </div>

          {selectedEgg && !selectedEgg.available && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
              Egg yang sedang digunakan tidak lagi di-assign ke node. Pilih Egg lain sebelum menyimpan.
            </div>
          )}

          {selectedEgg && (
            <div className="grid gap-4 rounded-lg border border-line-soft bg-base-900/40 p-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Docker image</p>
                <code className="block break-all font-mono text-xs text-ink-muted">
                  {selectedVersion?.docker_image || selectedEgg.docker_image}
                </code>
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Startup preview</p>
                <code className="block break-all font-mono text-xs text-ink-muted">{preview || '—'}</code>
                {hasUnknownVariables && (
                  <p className="mt-1 text-[10px] text-amber-300">Sebagian variable belum memiliki default value untuk preview.</p>
                )}
              </div>
            </div>
          )}

          {selectedEgg && selectedVersion && selectedVersion.download_provider && selectedVersion.download_provider !== 'none' && (
            <div className="space-y-3 rounded-lg border border-line-soft bg-base-900/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-ink-muted">
                  <span className="font-semibold text-ink">⬇ {DOWNLOAD_PROVIDER_INFO[selectedVersion.download_provider]}</span>
                  <span> · disimpan sebagai {selectedVersion.download_filename || 'server.jar'}</span>
                  {selectedVersion.download_executable ? ' · chmod +x setelah upload' : ''}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || downloadInProgress}
                  loading={downloadInProgress}
                  onClick={() => {
                    setError(null);
                    void runDownload(selectedVersion.id);
                  }}
                >
                  Download &amp; Install
                </Button>
              </div>
              <DownloadProgress state={download} />
            </div>
          )}

          {selectedEgg && (!selectedVersion || !selectedVersion.download_provider || selectedVersion.download_provider === 'none') && (
            <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-ink-faint">
              {selectedVersion
                ? 'Versi ini tidak memiliki auto download (provider: none) — upload file server (mis. server.jar) manual melalui File Manager sebelum menjalankan server.'
                : 'Konfigurasi bawaan Egg tidak memiliki auto download — upload file server (mis. server.jar) manual melalui File Manager.'}
            </p>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-ink-faint">
              Saat ini: {data.current.egg_name ?? 'Egg tidak terdaftar'} · {data.current.version_name ?? 'versi default'}
            </p>
            <Button onClick={() => { setError(null); setConfirmOpen(true); }} disabled={!canApply}>
              Simpan &amp; Reinstall
            </Button>
          </div>
        </div>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        title="Konfirmasi Docker & versi"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-100">
            Server akan direstart dan diinstall ulang dengan <strong>{targetTitle}</strong>. Data world dan plugin tetap aman. Lanjutkan?
          </div>
          {selectedVersion?.download_provider && selectedVersion.download_provider !== 'none' && (
            <div className="space-y-2">
              <p className="text-[11px] text-ink-muted">
                ⬇ {DOWNLOAD_PROVIDER_INFO[selectedVersion.download_provider]} — file server akan di-download
                otomatis sebelum reinstall dimulai.
              </p>
              <DownloadProgress state={download} />
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={busy}>Batal</Button>
            <Button onClick={() => void applyChange()} loading={busy} disabled={!canApply}>
              Konfirmasi &amp; Reinstall
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
