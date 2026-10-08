/**
 * Generic Auto Download System untuk Egg.
 *
 * Modul ini berisi:
 *  - Registry provider (built-in + custom) — SATU-SATUNYA tempat game/software
 *    yang didukung secara bawaan disebut. Custom provider memakai URL template
 *    bebas sehingga owner bisa mendukung software apapun tanpa mengubah kode.
 *  - Resolver: mengubah profil download (provider + variabel) menjadi URL file
 *    final, dengan fetch ke API publik masing-masing provider bila diperlukan.
 *
 * File ini isomorfik (tanpa dependency Node/server-only) — aman di-import
 * oleh komponen client untuk label/deskripsi provider.
 */

// ─── Registry provider ───────────────────────────────────────────────────────

import type { DownloadProvider } from '@/types';

export type { DownloadProvider } from '@/types';

export const DOWNLOAD_PROVIDERS: readonly DownloadProvider[] = [
  'none',
  'paper',
  'purpur',
  'vanilla',
  'fabric',
  'forge',
  'neoforge',
  'quilt',
  'bedrock',
  'custom',
];

export const BUILTIN_DOWNLOAD_PROVIDERS: DownloadProvider[] = DOWNLOAD_PROVIDERS.filter(
  (provider) => provider !== 'none' && provider !== 'custom',
);

export function isDownloadProvider(value: unknown): value is DownloadProvider {
  return typeof value === 'string' && (DOWNLOAD_PROVIDERS as readonly string[]).includes(value);
}

export const DOWNLOAD_PROVIDER_LABELS: Record<DownloadProvider, string> = {
  none: 'None (upload manual)',
  paper: 'Paper',
  purpur: 'Purpur',
  vanilla: 'Vanilla (Mojang)',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
  bedrock: 'Bedrock (Mojang)',
  custom: 'Custom URL Template',
};

/** Satu kalimat yang ditampilkan di tab Startup server. */
export const DOWNLOAD_PROVIDER_INFO: Record<DownloadProvider, string> = {
  none: 'Tidak ada auto download — file server diupload manual.',
  paper: 'Auto download via PaperMC API',
  purpur: 'Auto download via PurpurMC API',
  vanilla: 'Auto download via Mojang version manifest',
  fabric: 'Auto download via Fabric Meta API',
  forge: 'Auto download via Forge Maven (installer jar)',
  neoforge: 'Auto download via NeoForged Maven (installer jar)',
  quilt: 'Auto download via Quilt Meta API',
  bedrock: 'Auto download via minecraft.net (bedrock-server zip)',
  custom: 'Auto download via Custom URL',
};

/** Nama file default per provider saat owner belum mengisi download_filename. */
export const DEFAULT_DOWNLOAD_FILENAME: Record<DownloadProvider, string> = {
  none: 'server.jar',
  paper: 'server.jar',
  purpur: 'server.jar',
  vanilla: 'server.jar',
  fabric: 'server.jar',
  forge: 'server.jar',
  neoforge: 'server.jar',
  quilt: 'server.jar',
  bedrock: 'bedrock-server.zip',
  custom: 'server.jar',
};

// ─── Tipe profile & hasil resolusi ───────────────────────────────────────────

export interface DownloadProfile {
  provider: DownloadProvider;
  /** Dipakai sebagai MC_VERSION default bila variables tidak menimpanya. */
  minecraftVersion?: string | null;
  /** Wajib untuk provider 'custom'. Placeholder: {KEY}. */
  urlTemplate?: string | null;
  /** Variabel mentah dari egg_versions.download_variables (jsonb). */
  variables?: Record<string, unknown> | null;
  /** Override nama file (egg_versions.download_filename). */
  filename?: string | null;
  /** chmod +x setelah upload/ekstraksi (egg_versions.download_executable). */
  executable?: boolean | null;
}

export interface ResolvedDownload {
  provider: DownloadProvider;
  /** URL file final yang siap di-download. */
  url: string;
  /** Nama file yang akan disimpan di root server via Wings. */
  filename: string;
  /** Ukuran dalam byte bila diketahui dari metadata provider; null bila tidak. */
  size: number | null;
  /** true → file adalah arsip zip yang harus diekstrak (& dihapus) setelah upload. */
  extractAfterUpload: boolean;
  /** File (relatif dari root server) yang di-chmod 0755 setelah upload/ekstraksi. */
  chmodTargets: string[];
}

// ─── Utilitas variabel & template ────────────────────────────────────────────

/** jsonb → Record<string,string>; nilai non-skalar diabaikan. */
export function normalizeDownloadVariables(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      result[key] = String(item);
    }
  }
  return result;
}

/**
 * Gabungkan download_variables dengan default dari egg_version:
 * MC_VERSION/VERSION ← minecraft_version, BUILD ← 'latest'.
 * Nilai eksplisit di download_variables selalu menang.
 */
export function buildDownloadVariables(profile: DownloadProfile): Record<string, string> {
  const variables = normalizeDownloadVariables(profile.variables);
  const mcVersion = (variables.MC_VERSION ?? '').trim() || (profile.minecraftVersion ?? '').trim();
  if (mcVersion) {
    if (!variables.MC_VERSION?.trim()) variables.MC_VERSION = mcVersion;
    if (!variables.VERSION?.trim()) variables.VERSION = mcVersion;
  }
  if (!variables.BUILD?.trim()) variables.BUILD = 'latest';
  return variables;
}

/**
 * Substitusi placeholder {KEY} dalam URL template. Melempar error berisi daftar
 * variabel yang belum terisi bila ada placeholder tanpa nilai.
 */
export function substituteUrlTemplate(template: string, variables: Record<string, string>): string {
  const missing = new Set<string>();
  const url = template.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, key: string) => {
    const value = variables[key];
    if (value !== undefined && value !== '') return value;
    missing.add(key);
    return placeholder;
  });
  if (missing.size > 0) {
    throw new Error(`Variable URL template belum diisi: ${Array.from(missing).join(', ')}`);
  }
  return url;
}

/**
 * Validasi nama file hasil download: tidak boleh mengandung path separator,
 * dot-segment, atau kosong. Mengembalikan nama yang sudah bersih.
 */
export function sanitizeDownloadFilename(value: string | null | undefined, fallback: string): string {
  const name = (value ?? '').trim() || fallback;
  if (!name || name === '.' || name === '..' || name.length > 255 || /[\\/\0]/.test(name)) {
    throw new Error(
      `Download filename "${name || '(kosong)'}" tidak valid — gunakan nama file saja tanpa folder.`,
    );
  }
  return name;
}

// ─── Fetch helper (resolver memanggil API publik provider) ───────────────────

const RESOLVE_TIMEOUT_MS = 20_000;
const RESOLVE_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 HyunkPanel/0.1';

function describeFetchError(err: unknown, url: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `Permintaan ke ${host} melebihi batas waktu ${RESOLVE_TIMEOUT_MS / 1000} detik.`;
  }
  return `Gagal menghubungi ${host}: ${err instanceof Error ? err.message : 'unknown error'}`;
}

async function fetchProviderJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': RESOLVE_USER_AGENT, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(describeFetchError(err, url));
  }
  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} merespons HTTP ${response.status}.`);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`Respons dari ${new URL(url).hostname} bukan JSON yang valid.`);
  }
}

async function fetchProviderText(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': RESOLVE_USER_AGENT },
      cache: 'no-store',
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(describeFetchError(err, url));
  }
  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} merespons HTTP ${response.status}.`);
  }
  return response.text();
}

function last<T>(items: T[] | undefined): T | undefined {
  return items && items.length > 0 ? items[items.length - 1] : undefined;
}

/** '' atau 'latest' (case-insensitive) berarti "resolve versi terbaru". */
function wantsLatestVersion(value: string | undefined): boolean {
  return !value || value.trim().toLowerCase() === 'latest';
}

// ─── Resolver built-in ───────────────────────────────────────────────────────

interface ProviderResolution {
  url: string;
  /** Nama file yang disarankan provider bila owner tidak mengisi filename. */
  suggestedFilename: string;
  size?: number | null;
  extractAfterUpload?: boolean;
  /** Target chmod default untuk provider ini (dipakai saat executable = true). */
  executableName?: string;
}

/** Paper — https://api.papermc.io (v2). */
async function resolvePaper(mcVersion: string, build: string): Promise<ProviderResolution> {
  let mc = mcVersion.trim();
  if (wantsLatestVersion(mc)) {
    const project = await fetchProviderJson<{ versions?: string[] }>(
      'https://api.papermc.io/v2/projects/paper',
    );
    mc = last(project.versions) ?? '';
    if (!mc) throw new Error('PaperMC API tidak mengembalikan daftar versi Minecraft.');
  }
  const data = await fetchProviderJson<{
    builds?: Array<{ build?: number; downloads?: { application?: { name?: string } } }>;
  }>(`https://api.papermc.io/v2/projects/paper/versions/${encodeURIComponent(mc)}/builds`);
  const builds = (data.builds ?? []).filter(
    (entry): entry is { build: number; downloads?: { application?: { name?: string } } } =>
      typeof entry.build === 'number',
  );
  if (builds.length === 0) {
    throw new Error(`Paper tidak memiliki build untuk Minecraft ${mc}.`);
  }
  let selected = builds[builds.length - 1];
  if (build.trim().toLowerCase() !== 'latest') {
    const wanted = Number(build.trim());
    if (!Number.isInteger(wanted)) {
      throw new Error('BUILD untuk Paper harus "latest" atau nomor build (mis. 497).');
    }
    const found = builds.find((entry) => entry.build === wanted);
    if (!found) {
      throw new Error(
        `Build Paper #${wanted} untuk Minecraft ${mc} tidak ditemukan. Build terbaru: #${selected.build}.`,
      );
    }
    selected = found;
  }
  const name = selected.downloads?.application?.name ?? `paper-${mc}-${selected.build}.jar`;
  return {
    url: `https://api.papermc.io/v2/projects/paper/versions/${encodeURIComponent(mc)}/builds/${selected.build}/downloads/${encodeURIComponent(name)}`,
    suggestedFilename: 'server.jar',
  };
}

/** Purpur — https://api.purpurmc.org (v2). */
async function resolvePurpur(mcVersion: string, build: string): Promise<ProviderResolution> {
  let mc = mcVersion.trim();
  if (wantsLatestVersion(mc)) {
    const project = await fetchProviderJson<{ versions?: string[] }>('https://api.purpurmc.org/v2/purpur');
    mc = last(project.versions) ?? '';
    if (!mc) throw new Error('PurpurMC API tidak mengembalikan daftar versi Minecraft.');
  }
  const data = await fetchProviderJson<{ builds?: { latest?: string; all?: string[] } }>(
    `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mc)}`,
  );
  const latest = data.builds?.latest;
  if (build.trim().toLowerCase() === 'latest') {
    if (!latest) throw new Error(`Purpur tidak memiliki build untuk Minecraft ${mc}.`);
    return {
      url: `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mc)}/${encodeURIComponent(latest)}/download`,
      suggestedFilename: 'server.jar',
    };
  }
  const wanted = build.trim();
  if (!(data.builds?.all ?? []).includes(wanted)) {
    throw new Error(
      `Build Purpur ${wanted} untuk Minecraft ${mc} tidak ditemukan. Build terbaru: ${latest ?? 'tidak ada'}.`,
    );
  }
  return {
    url: `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mc)}/${encodeURIComponent(wanted)}/download`,
    suggestedFilename: 'server.jar',
  };
}

/** Vanilla — version_manifest Mojang (piston-meta). */
async function resolveVanilla(mcVersion: string): Promise<ProviderResolution> {
  const manifest = await fetchProviderJson<{
    latest?: { release?: string };
    versions?: Array<{ id?: string; url?: string }>;
  }>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const mc = wantsLatestVersion(mcVersion) ? (manifest.latest?.release ?? '') : mcVersion.trim();
  if (!mc) throw new Error('Version manifest Mojang tidak memiliki versi release terbaru.');
  const entry = (manifest.versions ?? []).find((item) => item.id === mc && typeof item.url === 'string');
  if (!entry?.url) {
    throw new Error(`Versi Minecraft ${mc} tidak ditemukan di version manifest Mojang.`);
  }
  const metadata = await fetchProviderJson<{
    downloads?: { server?: { url?: string; size?: number; sha1?: string } };
  }>(entry.url);
  const server = metadata.downloads?.server;
  if (!server?.url) {
    throw new Error(`Mojang tidak menyediakan server.jar untuk Minecraft ${mc} (versi terlalu lama?).`);
  }
  return {
    url: server.url,
    suggestedFilename: 'server.jar',
    size: typeof server.size === 'number' ? server.size : null,
  };
}

/** Fabric — https://meta.fabricmc.net (v2). BUILD = versi loader atau 'latest'. */
async function resolveFabric(mcVersion: string, build: string): Promise<ProviderResolution> {
  let mc = mcVersion.trim();
  if (wantsLatestVersion(mc)) {
    const games = await fetchProviderJson<Array<{ version?: string; stable?: boolean }>>(
      'https://meta.fabricmc.net/v2/versions/game',
    );
    mc = games.find((item) => item.stable && item.version)?.version ?? games[0]?.version ?? '';
    if (!mc) throw new Error('Fabric Meta tidak mengembalikan daftar versi Minecraft.');
  }
  const loaders = await fetchProviderJson<Array<{ loader?: { version?: string } }>>(
    `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`,
  );
  const loaderVersions = loaders
    .map((item) => item.loader?.version)
    .filter((version): version is string => typeof version === 'string' && version.length > 0);
  if (loaderVersions.length === 0) {
    throw new Error(`Fabric tidak memiliki loader untuk Minecraft ${mc}.`);
  }
  let loader = loaderVersions[0];
  if (build.trim().toLowerCase() !== 'latest') {
    if (!loaderVersions.includes(build.trim())) {
      throw new Error(
        `Fabric loader ${build.trim()} untuk Minecraft ${mc} tidak ditemukan. Loader terbaru: ${loader}.`,
      );
    }
    loader = build.trim();
  }
  const installers = await fetchProviderJson<Array<{ version?: string }>>(
    'https://meta.fabricmc.net/v2/versions/installer',
  );
  const installer = installers[0]?.version;
  if (!installer) throw new Error('Fabric Meta tidak mengembalikan versi installer.');
  return {
    url: `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loader)}/${encodeURIComponent(installer)}/server/jar`,
    suggestedFilename: 'server.jar',
  };
}

/** Forge — promotions_slim.json + maven.minecraftforge.net. BUILD juga menerima 'recommended'. */
async function resolveForge(mcVersion: string, build: string): Promise<ProviderResolution> {
  if (wantsLatestVersion(mcVersion)) {
    throw new Error('Field MC Version wajib diisi (mis. 1.20.1) untuk provider Forge.');
  }
  const mc = mcVersion.trim();
  let forgeVersion = build.trim();
  if (forgeVersion.toLowerCase() === 'latest' || forgeVersion.toLowerCase() === 'recommended') {
    const promotions = await fetchProviderJson<{ promos?: Record<string, string> }>(
      'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
    );
    const key = `${mc}-${forgeVersion.toLowerCase()}`;
    const promoted = promotions.promos?.[key];
    if (!promoted) {
      throw new Error(`Forge belum merilis build "${forgeVersion.toLowerCase()}" untuk Minecraft ${mc}.`);
    }
    forgeVersion = promoted;
  }
  const full = `${mc}-${forgeVersion}`;
  return {
    url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${encodeURIComponent(full)}/forge-${full}-installer.jar`,
    suggestedFilename: `forge-${full}-installer.jar`,
  };
}

/**
 * NeoForge — maven-metadata.xml di maven.neoforged.net.
 * Pemetaan versi: MC 1.21.4 → NeoForge 21.4.x (prefix MC tanpa "1.").
 */
async function resolveNeoForge(mcVersion: string, build: string): Promise<ProviderResolution> {
  const xml = await fetchProviderText(
    'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
  );
  const versions = Array.from(xml.matchAll(/<version>([^<]+)<\/version>/g), (match) => match[1].trim());
  if (versions.length === 0) {
    throw new Error('maven-metadata.xml NeoForge tidak berisi daftar versi.');
  }
  let selected: string | undefined;
  if (build.trim().toLowerCase() !== 'latest') {
    selected = build.trim();
    if (!versions.includes(selected)) {
      throw new Error(
        `Versi NeoForge ${selected} tidak ditemukan di maven.neoforged.net. Versi terbaru: ${last(versions)}.`,
      );
    }
  } else if (wantsLatestVersion(mcVersion)) {
    selected = /<latest>([^<]+)<\/latest>/.exec(xml)?.[1]?.trim() || last(versions);
  } else {
    const prefix = mcVersion.trim().replace(/^1\./, '');
    const candidates = versions.filter(
      (version) => version.startsWith(`${prefix}.`) || version === prefix,
    );
    selected = last(candidates);
    if (!selected) {
      throw new Error(
        `NeoForge tidak memiliki rilis untuk Minecraft ${mcVersion.trim()} (prefix ${prefix}.x) di maven.neoforged.net.`,
      );
    }
  }
  if (!selected) throw new Error('Tidak dapat menentukan versi NeoForge.');
  return {
    url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${encodeURIComponent(selected)}/neoforge-${selected}-installer.jar`,
    suggestedFilename: `neoforge-${selected}-installer.jar`,
  };
}

/** Quilt — https://meta.quiltmc.org (v3). BUILD = versi loader atau 'latest'. */
async function resolveQuilt(mcVersion: string, build: string): Promise<ProviderResolution> {
  let mc = mcVersion.trim();
  if (wantsLatestVersion(mc)) {
    const games = await fetchProviderJson<Array<{ version?: string; stable?: boolean }>>(
      'https://meta.quiltmc.org/v3/versions/game',
    );
    mc = games.find((item) => item.stable && item.version)?.version ?? games[0]?.version ?? '';
    if (!mc) throw new Error('Quilt Meta tidak mengembalikan daftar versi Minecraft.');
  }
  const loaders = await fetchProviderJson<Array<{ version?: string; stable?: boolean }>>(
    'https://meta.quiltmc.org/v3/versions/loader',
  );
  const loaderVersions = loaders
    .map((item) => item.version)
    .filter((version): version is string => typeof version === 'string' && version.length > 0);
  if (loaderVersions.length === 0) throw new Error('Quilt Meta tidak mengembalikan daftar loader.');
  let loader = loaders.find((item) => item.stable && item.version)?.version ?? loaderVersions[0];
  if (build.trim().toLowerCase() !== 'latest') {
    if (!loaderVersions.includes(build.trim())) {
      throw new Error(`Quilt loader ${build.trim()} tidak ditemukan. Loader terbaru: ${loaderVersions[0]}.`);
    }
    loader = build.trim();
  }
  const installers = await fetchProviderJson<Array<{ version?: string }>>(
    'https://meta.quiltmc.org/v3/versions/installer',
  );
  const installer = installers[0]?.version;
  if (!installer) throw new Error('Quilt Meta tidak mengembalikan versi installer.');
  return {
    url: `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loader)}/${encodeURIComponent(installer)}/server/jar`,
    suggestedFilename: 'server.jar',
  };
}

/**
 * Bedrock — URL binary publik di minecraft.net. BUILD = nomor versi Bedrock
 * (mis. 1.21.44.01) atau 'latest' (di-scrape dari halaman download resmi).
 */
async function resolveBedrock(build: string): Promise<ProviderResolution> {
  let version = build.trim();
  if (version.toLowerCase() === 'latest') {
    const page = await fetchProviderText('https://www.minecraft.net/en-us/download/server/bedrock');
    const match = /bedrockdedicatedserver\/bin-linux\/bedrock-server-([0-9][0-9.]*)\.zip/.exec(page);
    if (!match) {
      throw new Error(
        'Gagal mendeteksi versi Bedrock terbaru dari minecraft.net. Isi BUILD dengan nomor versi manual (mis. 1.21.44.01).',
      );
    }
    version = match[1];
  } else if (!/^\d+\.\d+[\d.]*$/.test(version)) {
    throw new Error('BUILD untuk Bedrock harus "latest" atau nomor versi (mis. 1.21.44.01).');
  }
  return {
    url: `https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-${version}.zip`,
    suggestedFilename: 'bedrock-server.zip',
    extractAfterUpload: true,
    executableName: 'bedrock_server',
  };
}

// ─── Resolver utama ──────────────────────────────────────────────────────────

/**
 * Resolve profil download menjadi URL final + rencana pasca-upload.
 * Melempar Error berbahasa Indonesia yang aman ditampilkan ke UI.
 */
export async function resolveEggDownload(profile: DownloadProfile): Promise<ResolvedDownload> {
  const provider = profile.provider;
  if (provider === 'none') {
    throw new Error('Versi ini tidak memiliki auto download (provider: none) — upload file manual.');
  }

  const variables = buildDownloadVariables(profile);
  const mcVersion = variables.MC_VERSION ?? '';
  const build = variables.BUILD ?? 'latest';

  let resolution: ProviderResolution;
  if (provider === 'custom') {
    const template = profile.urlTemplate?.trim();
    if (!template) {
      throw new Error('Provider custom membutuhkan download_url_template yang berisi placeholder {KEY}.');
    }
    const url = substituteUrlTemplate(template, variables);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`URL template menghasilkan URL yang tidak valid: ${url}`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('URL download harus memakai skema http/https.');
    }
    const baseName = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '');
    resolution = {
      url,
      suggestedFilename: baseName && !/[\\/\0]/.test(baseName) ? baseName : 'server.jar',
    };
  } else {
    switch (provider) {
      case 'paper':
        resolution = await resolvePaper(mcVersion, build);
        break;
      case 'purpur':
        resolution = await resolvePurpur(mcVersion, build);
        break;
      case 'vanilla':
        resolution = await resolveVanilla(mcVersion);
        break;
      case 'fabric':
        resolution = await resolveFabric(mcVersion, build);
        break;
      case 'forge':
        resolution = await resolveForge(mcVersion, build);
        break;
      case 'neoforge':
        resolution = await resolveNeoForge(mcVersion, build);
        break;
      case 'quilt':
        resolution = await resolveQuilt(mcVersion, build);
        break;
      case 'bedrock':
        resolution = await resolveBedrock(build);
        break;
      default:
        throw new Error(`Provider "${provider as string}" tidak dikenal.`);
    }
  }

  const filename = sanitizeDownloadFilename(profile.filename, resolution.suggestedFilename);
  const extractAfterUpload = Boolean(
    resolution.extractAfterUpload && filename.toLowerCase().endsWith('.zip'),
  );
  const chmodTargets = profile.executable ? [resolution.executableName ?? filename] : [];

  return {
    provider,
    url: resolution.url,
    filename,
    size: resolution.size ?? null,
    extractAfterUpload,
    chmodTargets,
  };
}
