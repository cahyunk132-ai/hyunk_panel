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
export type PluginLoader = 'paper' | 'purpur' | 'spigot' | 'bukkit';
export type ModLoader = 'fabric' | 'forge' | 'neoforge' | 'quilt';
export type ServerLoader = PluginLoader | ModLoader;
export type LoaderKind = 'plugin' | 'mod';

const MODRINTH_API = 'https://api.modrinth.com/v2';
const numberFormat = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });

const PLUGIN_LOADERS: PluginLoader[] = ['paper', 'purpur', 'spigot', 'bukkit'];
const MOD_LOADERS: ModLoader[] = ['fabric', 'forge', 'neoforge', 'quilt'];

/**
 * Urutan deteksi loader dari env STARTUP atau SERVER_JARFILE.
 * "neoforge" dicek sebelum "forge" karena string "neoforge" mengandung "forge".
 */
const LOADER_DETECTION_ORDER: ServerLoader[] = [
  'paper',
  'purpur',
  'spigot',
  'bukkit',
  'neoforge',
  'fabric',
  'forge',
  'quilt',
];

const LOADER_LABELS: Record<ServerLoader, string> = {
  paper: 'Paper',
  purpur: 'Purpur',
  spigot: 'Spigot',
  bukkit: 'Bukkit',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
};

const PLUGIN_SERVER_CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'plugin', label: 'Plugin' },
  { key: 'datapack', label: 'Datapack' },
  { key: 'resourcepack', label: 'Resourcepack' },
];

const MOD_SERVER_CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'mod', label: 'Mod' },
  { key: 'resourcepack', label: 'Resourcepack' },
  { key: 'shader', label: 'Shader' },
];

const ALL_CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'plugin', label: 'Plugin' },
  { key: 'mod', label: 'Mod' },
  { key: 'resourcepack', label: 'Resourcepack' },
  { key: 'shader', label: 'Shader' },
  { key: 'datapack', label: 'Datapack' },
];

const TYPE_META: Record<string, { label: string; tone: 'accent' | 'green' | 'yellow' | 'red' | 'gray' | 'default'; icon: string; needsRestart: boolean }> = {
  plugin: { label: 'Plugin', tone: 'accent', icon: '🧩', needsRestart: true },
  mod: { label: 'Mod', tone: 'green', icon: '⚙️', needsRestart: true },
  resourcepack: { label: 'Resource Pack', tone: 'yellow', icon: '🎨', needsRestart: false },
  shader: { label: 'Shader', tone: 'red', icon: '✨', needsRestart: false },
  datapack: { label: 'Datapack', tone: 'gray', icon: '📦', needsRestart: true },
  modpack: { label: 'Modpack', tone: 'default', icon: '🗃️', needsRestart: true },
};

export function detectServerLoader(input: {
  startup?: string | null;
  env?: Record<string, string | undefined> | null;
}): ServerLoader | null {
  const sources = [
    input.env?.STARTUP,
    input.env?.SERVER_JARFILE,
    input.startup,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  for (const source of sources) {
    const lower = source.toLowerCase();
    for (const loader of LOADER_DETECTION_ORDER) {
      if (lower.includes(loader)) {
        return loader;
      }
    }
  }
  return null;
}

export function getLoaderKind(loader: ServerLoader): LoaderKind {
  return (PLUGIN_LOADERS as readonly string[]).includes(loader) ? 'plugin' : 'mod';
}

function getCategoriesForLoader(kind: LoaderKind | null): { key: CategoryKey; label: string }[] {
  if (kind === 'plugin') return PLUGIN_SERVER_CATEGORIES;
  if (kind === 'mod') return MOD_SERVER_CATEGORIES;
  return ALL_CATEGORIES;
}

/**
 * Bangun facets Modrinth otomatis sesuai loader server yang terdeteksi/dipilih.
 * Di API search Modrinth v2, filter loader menggunakan facet `categories:<loader>`.
 */
function buildFacets(category: CategoryKey, loader: ServerLoader): string[][] {
  const kind = getLoaderKind(loader);

  if (category === 'resourcepack') {
    return [['project_type:resourcepack']];
  }
  if (category === 'datapack') {
    return [['project_type:datapack']];
  }
  if (category === 'shader') {
    return [['project_type:shader']];
  }

  if (kind === 'plugin') {
    // Project plugin di Modrinth sering bertipe "mod" maupun "plugin" dengan kategori loader paper/spigot/bukkit/purpur.
    return [['project_type:plugin', 'project_type:mod'], [`categories:${loader}`]];
  }

  return [['project_type:mod'], [`categories:${loader}`]];
}

export function PluginDownloader({
  serverId,
  serverImage = 'java',
  startup = '',
  env = {},
  minecraftVersion,
  canInstall,
}: {
  serverId: string;
  serverImage?: string;
  startup?: string;
  env?: Record<string, string>;
  minecraftVersion: string;
  canInstall: boolean;
}) {
  const detectedLoader = detectServerLoader({ startup, env });
  const [selectedLoader, setSelectedLoader] = useState<ServerLoader | ''>('');
  const activeLoader: ServerLoader | null = detectedLoader ?? (selectedLoader || null);
  const loaderKind: LoaderKind | null = activeLoader ? getLoaderKind(activeLoader) : null;

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryKey>('all');
  const [hits, setHits] = useState<ModrinthProject[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});
  const [installingProject, setInstallingProject] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const imageLower = serverImage.toLowerCase();
  if (imageLower.includes('debian')) {
    return (
      <div className="rounded-xl border border-line bg-base-850 px-5 py-10 text-center">
        <p className="text-sm text-ink-muted">Tidak didukung untuk Bedrock server</p>
      </div>
    );
  }

  if (!imageLower.includes('java')) {
    return (
      <div className="rounded-xl border border-line bg-base-850 px-5 py-10 text-center">
        <p className="text-sm text-ink-muted">Fitur ini hanya tersedia untuk Java Edition</p>
      </div>
    );
  }

  async function runSearch(opts: { query: string; category: CategoryKey; loader: ServerLoader }) {
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
    if (!activeLoader) {
      setSearchError('Pilih loader server terlebih dahulu sebelum mencari.');
      return;
    }
    void runSearch({ query, category, loader: activeLoader });
  }

  function selectCategory(next: CategoryKey) {
    setCategory(next);
    if (searched && activeLoader) {
      void runSearch({ query, category: next, loader: activeLoader });
    }
  }

  function handleSelectLoader(next: ServerLoader | '') {
    setSelectedLoader(next);
    setSearchError('');
    if (!next) {
      setHits([]);
      setSearched(false);
      return;
    }
    const nextKind = getLoaderKind(next);
    const allowedCategories = getCategoriesForLoader(nextKind).map((item) => item.key);
    const nextCategory = allowedCategories.includes(category) ? category : 'all';
    if (nextCategory !== category) {
      setCategory(nextCategory);
    }
    if (searched) {
      void runSearch({ query, category: nextCategory, loader: next });
    }
  }

  async function install(project: ModrinthProject) {
    if (installingProject) return;
    if (!activeLoader) {
      setInstallStates((current) => ({
        ...current,
        [project.project_id]: {
          status: 'error',
          message: 'Pilih loader server terlebih dahulu sebelum install.',
        },
      }));
      return;
    }

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
          loader: activeLoader,
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
      const isJar = (data.filename ?? '').toLowerCase().endsWith('.jar');
      const typeMeta = projectType ? TYPE_META[projectType] : undefined;
      const target = data.directory ? ` ke ${data.directory}` : '';
      const needsRestart = isJar || typeMeta?.needsRestart;
      const restartNote = needsRestart ? ' Restart server untuk mengaktifkan.' : '';
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

  const availableCategories = getCategoriesForLoader(loaderKind);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Mod &amp; Plugin Downloader</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Cari dan pasang konten dari Modrinth. Folder tujuan disesuaikan berdasarkan loader server:{' '}
          plugin server (<code className="text-accent">/plugins</code>,{' '}
          <code className="text-accent">/world/datapacks</code>,{' '}
          <code className="text-accent">/resourcepacks</code>) atau mod server (
          <code className="text-accent">/mods</code>,{' '}
          <code className="text-accent">/resourcepacks</code>,{' '}
          <code className="text-accent">/shaderpacks</code>).
        </p>
      </div>

      <form onSubmit={search} className="flex flex-col gap-2 md:flex-row">
        <label htmlFor="modrinth-search" className="sr-only">Cari konten Modrinth</label>
        <input
          id="modrinth-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={!activeLoader}
          placeholder={
            activeLoader
              ? 'Cari di Modrinth, misalnya EssentialsX, Sodium, atau Complementary Shaders'
              : 'Pilih loader server terlebih dahulu sebelum mencari...'
          }
          className="min-w-0 flex-1 rounded-lg border border-line bg-base-850 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
        />
        <Button type="submit" loading={searching} disabled={!activeLoader}>
          Cari
        </Button>
      </form>

      {/* Badge loader terdeteksi / dropdown pilih loader jika tidak diketahui */}
      <div className="flex flex-wrap items-center gap-2.5">
        {detectedLoader ? (
          <Badge tone="accent">Loader terdeteksi: {LOADER_LABELS[detectedLoader]}</Badge>
        ) : (
          <>
            <Badge tone={activeLoader ? 'accent' : 'yellow'}>
              {activeLoader
                ? `Loader terdeteksi: ${LOADER_LABELS[activeLoader]}`
                : 'Loader terdeteksi: Tidak diketahui'}
            </Badge>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="server-loader-select" className="text-xs text-ink-muted">
                Pilih loader:
              </label>
              <select
                id="server-loader-select"
                value={selectedLoader}
                onChange={(event) => handleSelectLoader(event.target.value as ServerLoader | '')}
                aria-label="Pilih loader server"
                className="rounded-lg border border-line bg-base-850 px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent"
              >
                <option value="">-- Pilih loader dulu --</option>
                <optgroup label="Plugin Server (/plugins)">
                  {PLUGIN_LOADERS.map((loader) => (
                    <option key={loader} value={loader}>
                      {LOADER_LABELS[loader]}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Mod Server (/mods)">
                  {MOD_LOADERS.map((loader) => (
                    <option key={loader} value={loader}>
                      {LOADER_LABELS[loader]}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </>
        )}

        {loaderKind === 'plugin' && (
          <span className="text-xs text-ink-faint">
            Target: <code className="text-ink-muted">.jar → /plugins/</code> ·{' '}
            <code className="text-ink-muted">datapack → /world/datapacks/</code> ·{' '}
            <code className="text-ink-muted">resourcepack → /resourcepacks/</code>
          </span>
        )}
        {loaderKind === 'mod' && (
          <span className="text-xs text-ink-faint">
            Target: <code className="text-ink-muted">mod .jar → /mods/</code> ·{' '}
            <code className="text-ink-muted">resourcepack → /resourcepacks/</code> ·{' '}
            <code className="text-ink-muted">shader → /shaderpacks/</code>
          </span>
        )}
      </div>

      {!activeLoader && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          Loader server tidak dapat dideteksi otomatis dari <code className="font-mono">STARTUP</code> atau{' '}
          <code className="font-mono">SERVER_JARFILE</code>. Silakan pilih loader pada dropdown di atas terlebih dahulu
          sebelum mencari atau meng-install konten.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter kategori konten">
          {availableCategories.map((item) => {
            const active = category === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                disabled={!activeLoader}
                onClick={() => selectCategory(item.key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
          Tidak ada hasil yang cocok untuk loader {activeLoader ? LOADER_LABELS[activeLoader] : ''}. Coba kata kunci atau kategori lain.
        </div>
      )}

      {hits.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {hits.map((project) => {
            const state = installStates[project.project_id];
            const displayType =
              loaderKind === 'plugin' && (project.project_type === 'mod' || project.project_type === 'plugin')
                ? 'plugin'
                : project.project_type;
            const typeMeta = displayType ? TYPE_META[displayType] : undefined;
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
                      disabled={Boolean(installingProject) || !canInstall || !activeLoader}
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
