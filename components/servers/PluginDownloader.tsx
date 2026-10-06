'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';

type ModrinthProject = {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string | null;
  downloads: number;
  follows: number;
  versions?: string[];
  latest_version?: string;
};

type SearchResponse = { hits?: ModrinthProject[]; total_hits?: number };
type InstallState = { status: 'installing' | 'success' | 'error'; message: string };

const MODRINTH_API = 'https://api.modrinth.com/v2';
const numberFormat = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });

export function PluginDownloader({
  serverId,
  minecraftVersion,
  canInstall,
}: {
  serverId: string;
  minecraftVersion: string;
  canInstall: boolean;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ModrinthProject[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});
  const [installingProject, setInstallingProject] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setSearching(true);
    setSearchError('');
    setSearched(true);
    try {
      const url = new URL(`${MODRINTH_API}/search`);
      url.searchParams.set('query', query.trim());
      url.searchParams.set('facets', JSON.stringify([['project_type:plugin']]));
      url.searchParams.set('limit', '20');
      const response = await fetch(url.toString(), { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Modrinth merespons dengan status ${response.status}`);
      const data = (await response.json()) as SearchResponse;
      setHits(Array.isArray(data.hits) ? data.hits : []);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setHits([]);
      setSearchError(error instanceof Error ? error.message : 'Gagal mencari plugin di Modrinth');
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  async function install(project: ModrinthProject) {
    if (installingProject) return;
    setInstallingProject(project.project_id);
    setInstallStates((current) => ({
      ...current,
      [project.project_id]: {
        status: 'installing',
        message: 'Mencari versi yang kompatibel, lalu mengunduh dan mengunggah plugin ke server…',
      },
    }));

    try {
      const response = await fetch(`/api/servers/${serverId}/plugins/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.project_id,
          version_id: project.latest_version ?? '',
          // URL dan nama file ditentukan ulang oleh server dari data resmi Modrinth.
          file_url: '',
          filename: '',
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; filename?: string };
      if (!response.ok) throw new Error(data.error || 'Plugin gagal di-install');
      setInstallStates((current) => ({
        ...current,
        [project.project_id]: {
          status: 'success',
          message: `${data.filename || 'Plugin'} berhasil dipasang. Restart server untuk mengaktifkan.`,
        },
      }));
    } catch (error) {
      setInstallStates((current) => ({
        ...current,
        [project.project_id]: {
          status: 'error',
          message: error instanceof Error ? error.message : 'Plugin gagal di-install',
        },
      }));
    } finally {
      setInstallingProject(null);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Plugin Downloader</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Cari dan pasang plugin dari Modrinth langsung ke folder <code className="text-accent">/plugins</code>.
        </p>
      </div>

      <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="plugin-search" className="sr-only">Cari plugin</label>
        <input
          id="plugin-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari plugin, misalnya EssentialsX atau WorldEdit"
          className="min-w-0 flex-1 rounded-lg border border-line bg-base-850 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <Button type="submit" loading={searching}>Cari plugin</Button>
      </form>

      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <span>Platform: Modrinth</span>
        <span aria-hidden="true">·</span>
        <span>
          Versi server: <span className="font-mono text-ink-muted">{minecraftVersion || 'tidak terdeteksi'}</span>
        </span>
      </div>
      {!canInstall && (
        <p className="text-xs text-ink-faint">Permission files.edit diperlukan untuk memasang plugin.</p>
      )}

      {searchError && (
        <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {searchError}
        </div>
      )}

      {searched && !searching && !searchError && hits.length === 0 && (
        <div className="rounded-xl border border-line bg-base-850 px-4 py-8 text-center text-sm text-ink-muted">
          Tidak ada plugin ditemukan. Coba kata kunci lain.
        </div>
      )}

      {hits.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {hits.map((project) => {
            const state = installStates[project.project_id];
            return (
              <article key={project.project_id} className="flex min-w-0 gap-3 rounded-xl border border-line bg-base-850 p-4">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-base-700">
                  {project.icon_url ? (
                    // Modrinth supplies public project icons.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={project.icon_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-xl" aria-hidden="true">🧩</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-ink">{project.title}</h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{project.description}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => install(project)}
                      disabled={Boolean(installingProject) || !canInstall}
                      loading={installingProject === project.project_id}
                    >
                      Install
                    </Button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                    <span>↓ {numberFormat.format(project.downloads || 0)} downloads</span>
                    <span>♡ {numberFormat.format(project.follows || 0)} followers</span>
                  </div>

                  {Array.isArray(project.versions) && project.versions.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[11px] text-ink-faint">Versi Minecraft:</span>
                      {project.versions.slice(0, 6).map((version) => (
                        <span key={version} className="rounded bg-base-700 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                          {version}
                        </span>
                      ))}
                      {project.versions.length > 6 && <span className="text-[10px] text-ink-faint">+{project.versions.length - 6}</span>}
                    </div>
                  )}

                  {state && (
                    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                      state.status === 'success'
                        ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300'
                        : state.status === 'error'
                          ? 'border-red-500/25 bg-red-500/5 text-red-300'
                          : 'border-accent/25 bg-accent/5 text-ink-muted'
                    }`}>
                      {state.status === 'installing' && (
                        <div
                          className="mb-2 h-1.5 overflow-hidden rounded-full bg-base-700"
                          role="progressbar"
                          aria-label="Plugin sedang diunduh dan diunggah"
                        >
                          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
                        </div>
                      )}
                      <p>{state.message}</p>
                      {state.status === 'error' && (
                        <button
                          type="button"
                          onClick={() => install(project)}
                          className="mt-2 font-medium text-ink underline underline-offset-2"
                        >
                          Coba lagi
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
