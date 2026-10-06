'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

type ModrinthProject = {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string | null;
  project_type?: string;
  downloads: number;
  follows: number;
  versions?: string[];
  latest_version?: string;
};

type SearchResponse = { hits?: ModrinthProject[]; total_hits?: number };
type InstallState = { status: 'installing' | 'success' | 'error'; message: string };

type CategoryKey = 'all' | 'plugin' | 'mod' | 'resourcepack' | 'shader' | 'datapack';
type ModLoader = 'fabric' | 'forge' | 'neoforge' | 'quilt';

const MODRINTH_API = 'https://api.modrinth.com/v2';
const numberFormat = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'plugin', label: 'Plugin' },
  { key: 'mod', label: 'Mod' },
  { key: 'resourcepack', label: 'Resourcepack' },
  { key: 'shader', label: 'Shader' },
  { key: 'datapack', label: 'Datapack' },
];

const MOD_LOADER_OPTIONS: { value: ModLoader | 'all'; label: string }[] = [
  { value: 'all', label: 'Semua loader' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'quilt', label: 'Quilt' },
];

/**
 * Tipe yang bisa di-install dari panel. "Semua" dibatasi ke tipe-tipe ini
 * supaya hasil pencarian tidak menampilkan modpack yang tidak bisa di-install.
 */
const INSTALLABLE_TYPES: Exclude<CategoryKey, 'all'>[] = ['plugin', 'mod', 'resourcepack', 'shader', 'datapack'];

const TYPE_META: Record<string, { label: string; tone: 'accent' | 'green' | 'yellow' | 'red' | 'gray' | 'default'; icon: string; needsRestart: boolean }> = {
  plugin: { label: 'Plugin', tone: 'accent', icon: '🧩', needsRestart: true },
  mod: { label: 'Mod', tone: 'green', icon: '⚙️', needsRestart: true },
  resourcepack: { label: 'Resource Pack', tone: 'yellow', icon: '🎨', needsRestart: false },
  shader: { label: 'Shader', tone: 'red', icon: '✨', needsRestart: false },
  datapack: { label: 'Datapack', tone: 'gray', icon: '📦', needsRestart: true },
  modpack: { label: 'Modpack', tone: 'default', icon: '🗃️', needsRestart: true },
};

function buildFacets(category: CategoryKey, loader: ModLoader | 'all'): string[][] {
  if (category === 'all') {
    return [INSTALLABLE_TYPES.map((type) => `project_type:${type}`)];
  }
  const facets: string[][] = [[`project_type:${category}`]];
  if (category === 'mod' && loader !== 'all') facets.push([`loaders:${loader}`]);
  return facets;
}

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
  const [category, setCategory] = useState<CategoryKey>('all');
  const [modLoader, setModLoader] = useState<ModLoader | 'all'>('all');
  const [hits, setHits] = useState<ModrinthProject[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});
  const [installingProject, setInstallingProject] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  async function runSearch(opts: { query: string; category: CategoryKey; loader: ModLoader | 'all' }) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setSearching(true);
    setSearchError('');
    setSearched(true);
    try {
      const url = new URL(`${MODRINTH_API}/search`);
      url.searchParams.set('query', opts.query.trim());
      url.searchParams.set('facets', JSON.stringify(buildFacets(opts.category, opts.loader)));
      url.searchParams.set('limit', '20');
      const response = await fetch(url.toString(), { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Modrinth merespons dengan status ${response.status}`);
      const data = (await response.json()) as SearchResponse;
      setHits(Array.isArray(data.hits) ? data.hits : []);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setHits([]);
      setSearchError(error instanceof Error ? error.message : 'Gagal mencari konten di Modrinth');
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  function search(event?: FormEvent) {
    event?.preventDefault();
    void runSearch({ query, category, loader: modLoader });
  }

  function selectCategory(next: CategoryKey) {
    setCategory(next);
    if (searched) void runSearch({ query, category: next, loader: modLoader });
  }

  function selectLoader(next: ModLoader | 'all') {
    setModLoader(next);
    if (searched) void runSearch({ query, category, loader: next });
  }

  async function install(project: ModrinthProject) {
    if (installingProject) return;
    setInstallingProject(project.project_id);
    setInstallStates((current) => ({
      ...current,
      [project.project_id]: {
        status: 'installing',
        message: 'Mencari versi yang kompatibel, lalu mengunduh dan mengunggah file ke server…',
      },
    }));

    try {
      const projectType = project.project_type ?? (category !== 'all' ? category : undefined);
      const response = await fetch(`/api/servers/${serverId}/plugins/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.project_id,
          version_id: project.latest_version ?? '',
          project_type: projectType,
          // Loader pilihan user diteruskan supaya versi yang dipasang sesuai.
          ...(projectType === 'mod' && modLoader !== 'all' ? { loader: modLoader } : {}),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        filename?: string;
        directory?: string;
      };
      if (!response.ok) {
        throw new Error(
          data.error || `Install gagal (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''})`,
        );
      }
      const typeMeta = projectType ? TYPE_META[projectType] : undefined;
      const target = data.directory ? ` ke ${data.directory}` : '';
      const restartNote = typeMeta?.needsRestart ? ' Restart server untuk mengaktifkan.' : '';
      setInstallStates((current) => ({
        ...current,
        [project.project_id]: {
          status: 'success',
          message: `${data.filename || 'Konten'} berhasil dipasang${target}.${restartNote}`,
        },
      }));
    } catch (error) {
      setInstallStates((current) => ({
        ...current,
        [project.project_id]: {
          status: 'error',
          message: error instanceof Error ? error.message : 'Konten gagal di-install',
        },
      }));
    } finally {
      setInstallingProject(null);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Mod &amp; Plugin Downloader</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Cari dan pasang konten dari Modrinth. Folder tujuan dibuat otomatis: plugin ke{' '}
          <code className="text-accent">/plugins</code>, mod ke <code className="text-accent">/mods</code>,
          resourcepack ke <code className="text-accent">/resourcepacks</code>, shader ke{' '}
          <code className="text-accent">/shaderpacks</code>, datapack ke{' '}
          <code className="text-accent">/world/datapacks</code>.
        </p>
      </div>

      <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="modrinth-search" className="sr-only">Cari konten Modrinth</label>
        <input
          id="modrinth-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari di Modrinth, misalnya EssentialsX, Sodium, atau Complementary Shaders"
          className="min-w-0 flex-1 rounded-lg border border-line bg-base-850 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <Button type="submit" loading={searching}>Cari</Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter kategori konten">
          {CATEGORIES.map((item) => {
            const active = category === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => selectCategory(item.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-accent/60 bg-accent/10 text-accent'
                    : 'border-line bg-base-850 text-ink-muted hover:border-accent/40 hover:text-ink'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {category === 'mod' && (
          <select
            value={modLoader}
            onChange={(event) => selectLoader(event.target.value as ModLoader | 'all')}
            aria-label="Filter loader mod"
            className="rounded-lg border border-line bg-base-850 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent"
          >
            {MOD_LOADER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <span>Platform: Modrinth</span>
        <span aria-hidden="true">·</span>
        <span>
          Versi server: <span className="font-mono text-ink-muted">{minecraftVersion || 'tidak terdeteksi'}</span>
        </span>
      </div>
      {!canInstall && (
        <p className="text-xs text-ink-faint">Permission files.edit diperlukan untuk memasang konten.</p>
      )}

      {searchError && (
        <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {searchError}
        </div>
      )}

      {searched && !searching && !searchError && hits.length === 0 && (
        <div className="rounded-xl border border-line bg-base-850 px-4 py-8 text-center text-sm text-ink-muted">
          Tidak ada hasil yang cocok. Coba kata kunci atau kategori lain.
        </div>
      )}

      {hits.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {hits.map((project) => {
            const state = installStates[project.project_id];
            const typeMeta = project.project_type ? TYPE_META[project.project_type] : undefined;
            return (
              <article key={project.project_id} className="flex min-w-0 gap-3 rounded-xl border border-line bg-base-850 p-4">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-base-700">
                  {project.icon_url ? (
                    // Modrinth supplies public project icons.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={project.icon_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-xl" aria-hidden="true">
                      {typeMeta?.icon ?? '🧩'}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold text-ink">{project.title}</h3>
                        {typeMeta && <Badge tone={typeMeta.tone}>{typeMeta.label}</Badge>}
                      </div>
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
                          aria-label="Konten sedang diunduh dan diunggah"
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
