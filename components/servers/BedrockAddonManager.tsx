'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { InstalledBedrockAddon } from '@/lib/minecraft/bedrock-addons';

type ProjectType = 'mod' | 'resourcepack';

type ModrinthProject = {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url?: string | null;
  project_type: string;
  downloads: number;
  follows: number;
  categories?: string[];
  versions?: string[];
};

type ModrinthFile = { url?: string; filename?: string; primary?: boolean };
type ModrinthVersion = { files?: ModrinthFile[]; loaders?: string[] };
type SearchResponse = { hits?: ModrinthProject[] };
type InstallState = {
  status: 'installing' | 'success' | 'error';
  message: string;
  detectedType?: string;
};

const MODRINTH_API = 'https://api.modrinth.com/v2';
const downloadFormat = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });

function messageFromJson(json: Record<string, unknown>, fallback: string): string {
  return typeof json.error === 'string' ? json.error : fallback;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function isSupportedProject(project: ModrinthProject): project is ModrinthProject & { project_type: ProjectType } {
  return project.project_type === 'mod' || project.project_type === 'resourcepack';
}

function projectTypeLabel(project: ModrinthProject, detectedType?: string): string {
  if (detectedType) return detectedType;
  return project.project_type === 'resourcepack' ? 'Resource Pack' : 'Behavior Pack / Addon';
}

function installedTypeLabel(type: InstalledBedrockAddon['type']): string {
  return type === 'resource' ? 'Resource Pack' : 'Behavior Pack';
}

export function BedrockAddonManager({
  serverId,
  canInstall,
}: {
  serverId: string;
  canInstall: boolean;
}) {
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<ModrinthProject[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});
  const [installingProject, setInstallingProject] = useState<string | null>(null);

  const [addons, setAddons] = useState<InstalledBedrockAddon[]>([]);
  const [loadingAddons, setLoadingAddons] = useState(true);
  const [refreshingAddons, setRefreshingAddons] = useState(false);
  const [addonsError, setAddonsError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<InstalledBedrockAddon | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const loadAddons = useCallback(async (silent = false) => {
    if (silent) setRefreshingAddons(true);
    else setLoadingAddons(true);
    try {
      const response = await fetch(`/api/servers/${serverId}/bedrock/addons`, { cache: 'no-store' });
      const json = await readJson(response);
      if (!response.ok) throw new Error(messageFromJson(json, 'Gagal membaca addon terpasang'));
      setAddons(Array.isArray(json.addons) ? (json.addons as InstalledBedrockAddon[]) : []);
      setAddonsError('');
    } catch (error) {
      setAddonsError(error instanceof Error ? error.message : 'Gagal membaca addon terpasang');
    } finally {
      setLoadingAddons(false);
      setRefreshingAddons(false);
    }
  }, [serverId]);

  useEffect(() => {
    void loadAddons();
  }, [loadAddons]);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    setSearching(true);
    setSearchError('');
    setSearched(true);
    try {
      const url = new URL(`${MODRINTH_API}/search`);
      url.searchParams.set('query', query.trim());
      url.searchParams.set('facets', JSON.stringify([['categories:bedrock']]));
      url.searchParams.set('limit', '20');
      const response = await fetch(url.toString(), { cache: 'no-store' });
      if (!response.ok) throw new Error(`Modrinth merespons dengan status ${response.status}`);
      const data = (await response.json()) as SearchResponse;
      setProjects(Array.isArray(data.hits) ? data.hits : []);
    } catch (error) {
      setProjects([]);
      setSearchError(error instanceof Error ? error.message : 'Gagal mencari addon di Modrinth');
    } finally {
      setSearching(false);
    }
  }

  async function install(project: ModrinthProject) {
    if (installingProject || !isSupportedProject(project)) return;
    setInstallingProject(project.project_id);
    setInstallStates((current) => ({
      ...current,
      [project.project_id]: {
        status: 'installing',
        message: 'Mencari versi Bedrock, mengunduh, lalu mengekstrak file langsung di server…',
      },
    }));

    try {
      const versionsUrl = new URL(
        `${MODRINTH_API}/project/${encodeURIComponent(project.project_id)}/version`,
      );
      versionsUrl.searchParams.set('loaders', JSON.stringify(['bedrock']));
      const versionsResponse = await fetch(versionsUrl.toString(), { cache: 'no-store' });
      if (!versionsResponse.ok) {
        throw new Error(`Gagal membaca versi Modrinth (${versionsResponse.status})`);
      }
      const versions = (await versionsResponse.json()) as ModrinthVersion[];
      const allowed = (filename?: string) => {
        const lower = (filename ?? '').toLowerCase();
        if (project.project_type === 'resourcepack') return lower.endsWith('.mcpack');
        return lower.endsWith('.mcpack') || lower.endsWith('.mcaddon');
      };
      const selected = Array.isArray(versions)
        ? versions.flatMap((version) => {
            const files = Array.isArray(version.files) ? version.files : [];
            const match = files.find((file) => file.primary && allowed(file.filename)) ?? files.find((file) => allowed(file.filename));
            return match ? [match] : [];
          })[0]
        : undefined;
      if (!selected?.url || !selected.filename) {
        throw new Error(
          project.project_type === 'resourcepack'
            ? 'Tidak ditemukan file .mcpack yang kompatibel untuk Resource Pack ini.'
            : 'Tidak ditemukan file .mcpack atau .mcaddon dengan loader Bedrock.',
        );
      }

      const response = await fetch(`/api/servers/${serverId}/bedrock/addons/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_url: selected.url,
          filename: selected.filename,
          project_type: project.project_type,
        }),
      });
      const json = await readJson(response);
      if (!response.ok) throw new Error(messageFromJson(json, `Install gagal (HTTP ${response.status})`));

      const installedPacks = Array.isArray(json.packs)
        ? (json.packs as Array<{ pack_name?: string; type?: string }>)
        : [];
      const detectedTypes = installedPacks.length > 0
        ? Array.from(new Set(installedPacks.map((pack) => pack.type === 'resource' ? 'Resource Pack' : 'Behavior Pack')))
        : [json.type === 'addon' ? 'Addon' : projectTypeLabel(project)];
      const packNames = installedPacks.map((pack) => pack.pack_name).filter(Boolean);
      let message = `${packNames.length ? packNames.join(', ') : project.title} berhasil dipasang (${detectedTypes.join(' + ')}). Restart server untuk memuat pack.`;
      if (json.requires_education_features === true) {
        message += json.education_features_enabled === true
          ? ' Education features diaktifkan lewat console.'
          : ` Pack membutuhkan education features; command belum berhasil dikirim${typeof json.education_features_message === 'string' ? `: ${json.education_features_message}` : '.'}`;
      }
      const detectedType = selected.filename.toLowerCase().endsWith('.mcaddon')
        ? 'Addon'
        : detectedTypes.join(' + ');
      setInstallStates((current) => ({
        ...current,
        [project.project_id]: { status: 'success', message, detectedType },
      }));
      await loadAddons(true);
    } catch (error) {
      setInstallStates((current) => ({
        ...current,
        [project.project_id]: {
          status: 'error',
          message: error instanceof Error ? error.message : 'Gagal memasang addon Bedrock',
        },
      }));
    } finally {
      setInstallingProject(null);
    }
  }

  async function removeAddon() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const response = await fetch(
        `/api/servers/${serverId}/bedrock/addons/${encodeURIComponent(deleteTarget.pack_id)}`,
        { method: 'DELETE' },
      );
      const json = await readJson(response);
      if (!response.ok) throw new Error(messageFromJson(json, 'Gagal menghapus addon'));
      setDeleteTarget(null);
      await loadAddons(true);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Gagal menghapus addon');
    } finally {
      setDeleting(false);
    }
  }

  const visibleProjects = projects.filter(isSupportedProject);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Bedrock Addons</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">
          Cari Resource Pack dan addon Bedrock di Modrinth. File <code className="text-accent">.mcpack</code> dan{' '}
          <code className="text-accent">.mcaddon</code> diunduh serta diekstrak di server, lalu ditambahkan ke daftar pack world aktif.
        </p>
      </div>

      <div className="space-y-3">
        <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="bedrock-addon-search" className="sr-only">Cari addon Bedrock di Modrinth</label>
          <input
            id="bedrock-addon-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari addon, misalnya furniture, ores, atau textures"
            className="min-w-0 flex-1 rounded-lg border border-line bg-base-850 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent"
          />
          <Button type="submit" loading={searching}>Cari addon</Button>
        </form>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <Badge tone="accent">Modrinth · loader Bedrock</Badge>
          <span>Format yang didukung: .mcpack dan .mcaddon</span>
          {!canInstall && <span className="text-amber-300">Permission files.edit diperlukan untuk memasang atau menghapus addon.</span>}
        </div>
      </div>

      {searchError && (
        <div role="alert" className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {searchError}
        </div>
      )}
      {searched && !searching && !searchError && visibleProjects.length === 0 && (
        <div className="rounded-xl border border-line bg-base-850 px-4 py-8 text-center text-sm text-ink-muted">
          Tidak ada addon Bedrock yang cocok. Coba kata kunci lain.
        </div>
      )}

      {visibleProjects.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visibleProjects.map((project) => {
            const state = installStates[project.project_id];
            const label = projectTypeLabel(project, state?.detectedType);
            const resourcePack = project.project_type === 'resourcepack';
            return (
              <article key={project.project_id} className="flex min-w-0 gap-3 rounded-xl border border-line bg-base-850 p-4">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-base-700">
                  {project.icon_url ? (
                    // Modrinth serves public project icons.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={project.icon_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-xl" aria-hidden="true">
                      {resourcePack ? '🎨' : '🧩'}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold text-ink">{project.title}</h3>
                        <Badge tone={resourcePack ? 'yellow' : 'green'}>{label}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{project.description}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => void install(project)}
                      disabled={Boolean(installingProject) || !canInstall}
                      loading={installingProject === project.project_id}
                    >
                      Install
                    </Button>
                  </div>
                  {!resourcePack && !state?.detectedType && (
                    <p className="mt-2 text-[11px] text-ink-faint">Mod Bedrock: Behavior Pack (.mcpack) atau Addon (.mcaddon), tipe akhir dibaca dari manifest.</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                    <span>↓ {downloadFormat.format(project.downloads || 0)} downloads</span>
                    <span>♡ {downloadFormat.format(project.follows || 0)} followers</span>
                  </div>
                  {state && (
                    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                      state.status === 'success'
                        ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-300'
                        : state.status === 'error'
                          ? 'border-red-500/25 bg-red-500/5 text-red-300'
                          : 'border-accent/25 bg-accent/5 text-ink-muted'
                    }`}>
                      {state.status === 'installing' && (
                        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-base-700" role="progressbar" aria-label="Addon sedang diunduh dan dipasang">
                          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
                        </div>
                      )}
                      <p>{state.message}</p>
                      {state.status === 'error' && (
                        <button
                          type="button"
                          onClick={() => void install(project)}
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

      <div className="overflow-hidden rounded-xl border border-line bg-base-850">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Addon terpasang</h3>
            <p className="mt-0.5 text-xs text-ink-faint">Status Aktif mengikuti world_behavior_packs.json dan world_resource_packs.json.</p>
          </div>
          <Button variant="secondary" size="sm" loading={refreshingAddons || loadingAddons} onClick={() => void loadAddons(true)}>
            Refresh
          </Button>
        </div>

        {addonsError && (
          <div role="alert" className="m-4 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-sm text-red-300">
            {addonsError}
          </div>
        )}

        {loadingAddons ? (
          <div className="px-4 py-8 text-center text-sm text-ink-muted">Memuat addon terpasang…</div>
        ) : addons.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-ink-muted">Belum ada addon di folder behavior_packs atau resource_packs.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-line-soft text-[11px] uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="px-4 py-3 font-medium">Nama</th>
                  <th className="px-4 py-3 font-medium">Tipe</th>
                  <th className="px-4 py-3 font-medium">Versi</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {addons.map((addon) => (
                  <tr key={`${addon.type}-${addon.pack_id}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{addon.pack_name}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-ink-faint">{addon.pack_id}</div>
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{installedTypeLabel(addon.type)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-muted">{addon.version}</td>
                    <td className="px-4 py-3">
                      <Badge tone={addon.active ? 'green' : 'gray'}>{addon.active ? 'Aktif' : 'Tidak Aktif'}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={!canInstall || deleting}
                        onClick={() => {
                          setDeleteError('');
                          setDeleteTarget(addon);
                        }}
                      >
                        Hapus
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)} title="Hapus addon Bedrock">
        <div className="space-y-4">
          <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-200">
            Folder pack dan entry-nya dari daftar world akan dihapus. Tindakan ini tidak dapat dibatalkan.
            <div className="mt-2 font-semibold">{deleteTarget?.pack_name}</div>
          </div>
          {deleteError && <p role="alert" className="text-sm text-red-300">{deleteError}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>Batal</Button>
            <Button variant="danger" loading={deleting} onClick={() => void removeAddon()}>Hapus addon</Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
