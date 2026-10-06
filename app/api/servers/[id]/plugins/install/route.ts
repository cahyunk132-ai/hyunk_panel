import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings } from '@/lib/wings/resolve';
import { createUploadToken } from '@/lib/wings/jwt';
import type { WingsClient } from '@/lib/wings/client';

export const runtime = 'nodejs';

const MODRINTH_API = 'https://api.modrinth.com/v2';
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const USER_AGENT = 'HyunkPanel/0.1 (Modrinth mod & plugin installer)';

type PluginLoader = 'paper' | 'purpur' | 'spigot' | 'bukkit';
type ModLoader = 'fabric' | 'forge' | 'neoforge' | 'quilt';
type ServerLoader = PluginLoader | ModLoader;
type LoaderKind = 'plugin' | 'mod';

const PLUGIN_LOADERS: PluginLoader[] = ['paper', 'purpur', 'spigot', 'bukkit'];
const MOD_LOADERS: ModLoader[] = ['fabric', 'forge', 'neoforge', 'quilt'];
const ALL_LOADERS: ServerLoader[] = [...PLUGIN_LOADERS, ...MOD_LOADERS];

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

const SUPPORTED_PROJECT_TYPES = ['plugin', 'mod', 'resourcepack', 'shader', 'datapack'] as const;

type ModrinthFile = { url?: string; filename?: string; primary?: boolean };
type ModrinthVersion = { id?: string; loaders?: string[]; files?: ModrinthFile[] };
type ModrinthProject = { project_type?: string };

function detectServerLoader(input: {
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

function getLoaderKind(loader: ServerLoader): LoaderKind {
  return (PLUGIN_LOADERS as readonly string[]).includes(loader) ? 'plugin' : 'mod';
}

function isValidLoader(value: string): value is ServerLoader {
  return (ALL_LOADERS as readonly string[]).includes(value);
}

/**
 * Tentukan ekstensi yang diizinkan berdasarkan tipe project dan jenis loader server.
 */
function getAllowedExtensions(loaderKind: LoaderKind, projectType: string): string[] {
  if (projectType === 'resourcepack' || projectType === 'shader') {
    return ['.zip'];
  }
  if (projectType === 'datapack') {
    return loaderKind === 'plugin' ? ['.zip', '.jar'] : ['.zip'];
  }
  return ['.jar'];
}

/**
 * Logic folder tujuan berdasarkan loader/image server:
 *
 * Image mengandung "java" + loader Paper/Spigot/Bukkit/Purpur:
 *   → semua file .jar → /plugins
 *   → datapack → /world/datapacks
 *   → resourcepack → /resourcepacks
 *
 * Image mengandung "java" + loader Fabric/Forge/NeoForge/Quilt:
 *   → mod .jar → /mods
 *   → resourcepack → /resourcepacks
 *   → shader → /shaderpacks
 */
function resolveTargetByServerLoader(
  loaderKind: LoaderKind,
  projectType: string,
  filename: string,
): { directory: string; label: string } {
  const isJar = filename.toLowerCase().endsWith('.jar');

  if (loaderKind === 'plugin') {
    if (isJar) {
      return { directory: '/plugins', label: 'plugin' };
    }
    if (projectType === 'datapack') {
      return { directory: '/world/datapacks', label: 'datapack' };
    }
    if (projectType === 'resourcepack') {
      return { directory: '/resourcepacks', label: 'resource pack' };
    }
    return { directory: '/plugins', label: 'plugin' };
  }

  // loaderKind === 'mod' (Fabric / Forge / NeoForge / Quilt)
  if (isJar) {
    return { directory: '/mods', label: 'mod' };
  }
  if (projectType === 'resourcepack') {
    return { directory: '/resourcepacks', label: 'resource pack' };
  }
  if (projectType === 'shader') {
    return { directory: '/shaderpacks', label: 'shader' };
  }
  if (projectType === 'datapack') {
    return { directory: '/world/datapacks', label: 'datapack' };
  }
  return { directory: '/mods', label: 'mod' };
}

function safeFilename(value: string, allowedExtensions: string[]): string | null {
  const name = value.replace(/[\\/\0]/g, '_').replace(/[^A-Za-z0-9._ -]/g, '_').trim();
  const lower = name.toLowerCase();
  if (!name || name === '.' || name === '..' || name.length > 180) return null;
  if (!allowedExtensions.some((ext) => lower.endsWith(ext))) return null;
  return name;
}

async function modrinthJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'Project atau versi tidak ditemukan di Modrinth'
        : `Modrinth API error (${response.status})`,
    );
  }
  return (await response.json()) as T;
}

async function fetchModrinthVersions(
  projectId: string,
  mcVersion: string,
  versionLoaders: string[],
): Promise<ModrinthVersion[]> {
  const buildUrl = (includeMcVersion: boolean, includeLoaders: boolean) => {
    const url = new URL(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version`);
    if (includeMcVersion && mcVersion && mcVersion.toLowerCase() !== 'latest') {
      url.searchParams.set('game_versions', JSON.stringify([mcVersion]));
    }
    if (includeLoaders && versionLoaders.length > 0) {
      url.searchParams.set('loaders', JSON.stringify(versionLoaders));
    }
    return url;
  };

  const hasSpecificMcVersion = Boolean(mcVersion && mcVersion.toLowerCase() !== 'latest');
  const hasLoaders = versionLoaders.length > 0;

  let versions = await modrinthJson<ModrinthVersion[]>(buildUrl(hasSpecificMcVersion, hasLoaders));
  if ((!Array.isArray(versions) || versions.length === 0) && hasSpecificMcVersion) {
    // Fallback tanpa filter game_versions bila versi MC server tidak terdaftar persis di Modrinth.
    versions = await modrinthJson<ModrinthVersion[]>(buildUrl(false, hasLoaders));
  }
  return Array.isArray(versions) ? versions : [];
}

/**
 * Pastikan folder tujuan ada; buat per segmen bila belum.
 * Contoh: '/world/datapacks' → buat 'world' di '/', lalu 'datapacks' di '/world'.
 */
async function ensureDirectory(client: WingsClient, serverUuid: string, fullPath: string): Promise<void> {
  const segments = fullPath.split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    const parent = current || '/';
    const entries = await client.listFiles(serverUuid, parent);
    const existing = entries.find((entry) => entry.name === segment);
    if (existing && !existing.directory) {
      throw new Error(`Tidak bisa membuat folder ${fullPath}: "${segment}" sudah ada sebagai file`);
    }
    if (!existing) {
      await client.createDirectory(serverUuid, parent, segment);
    }
    current = `${current}/${segment}`;
  }
}

/**
 * Download file dari CDN lalu teruskan sebagai multipart stream ke Wings.
 * Tidak pernah meng-buffer keseluruhan file ke dalam memory.
 */
function multipartFileStream(
  fileBody: ReadableStream<Uint8Array>,
  boundary: string,
  filename: string,
  contentType: string,
  expectedBytes: number | null,
): ReadableStream<Uint8Array> {
  const reader = fileBody.getReader();
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  let sentPrefix = false;
  let sentSuffix = false;
  let downloaded = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!sentPrefix) {
          sentPrefix = true;
          controller.enqueue(prefix);
          return;
        }
        const chunk = await reader.read();
        if (chunk.done) {
          if (expectedBytes !== null && downloaded !== expectedBytes) {
            controller.error(new Error('Unduhan dari Modrinth terputus sebelum selesai'));
            return;
          }
          if (!sentSuffix) {
            sentSuffix = true;
            controller.enqueue(suffix);
          }
          controller.close();
          return;
        }
        downloaded += chunk.value.byteLength;
        if (downloaded > MAX_DOWNLOAD_BYTES || (expectedBytes !== null && downloaded > expectedBytes)) {
          await reader.cancel('Modrinth file size exceeded the allowed limit');
          controller.error(new Error('Ukuran file melebihi batas 100 MB'));
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

function multipartHeader(boundary: string, filename: string, contentType: string): string {
  return `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;

  const imageLower = checked.server.image.toLowerCase();
  if (imageLower.includes('debian')) {
    return Response.json(
      { error: 'Tidak didukung untuk Bedrock server' },
      { status: 400 },
    );
  }
  if (!imageLower.includes('java')) {
    return Response.json(
      { error: 'Download konten Modrinth hanya didukung untuk server Java Edition' },
      { status: 400 },
    );
  }

  let body: { project_id?: unknown; version_id?: unknown; project_type?: unknown; loader?: unknown } | null;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json(
      {
        error:
          'Body request tidak valid: server mengharapkan JSON (Content-Type: application/json) berisi project_id.',
      },
      { status: 400 },
    );
  }

  const projectId = typeof body?.project_id === 'string' ? body.project_id.trim() : '';
  if (!projectId) {
    return Response.json(
      { error: 'project_id wajib diisi — id project Modrinth yang ingin di-install' },
      { status: 400 },
    );
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId)) {
    return Response.json(
      { error: `project_id "${projectId}" tidak valid — id Modrinth hanya boleh berisi huruf, angka, "-" dan "_"` },
      { status: 400 },
    );
  }

  const requestedVersionId = typeof body?.version_id === 'string' ? body.version_id.trim() : '';
  const requestedType = typeof body?.project_type === 'string' ? body.project_type.trim().toLowerCase() : '';
  if (requestedType && !(SUPPORTED_PROJECT_TYPES as readonly string[]).includes(requestedType)) {
    return Response.json(
      {
        error: `Tipe project "${requestedType}" tidak didukung. Tipe yang didukung: ${SUPPORTED_PROJECT_TYPES.join(', ')}. Modpack belum bisa di-install dari panel.`,
      },
      { status: 400 },
    );
  }

  const requestedLoaderRaw = typeof body?.loader === 'string' ? body.loader.trim().toLowerCase() : '';
  if (requestedLoaderRaw && !isValidLoader(requestedLoaderRaw)) {
    return Response.json(
      {
        error: `Loader "${requestedLoaderRaw}" tidak didukung. Loader yang valid: ${ALL_LOADERS.join(', ')}`,
      },
      { status: 400 },
    );
  }

  const detectedLoader = detectServerLoader({
    startup: checked.server.startup,
    env: checked.server.env,
  });
  const serverLoader: ServerLoader | null =
    detectedLoader ?? (requestedLoaderRaw && isValidLoader(requestedLoaderRaw) ? requestedLoaderRaw : null);

  if (!serverLoader) {
    return Response.json(
      {
        error: 'Loader server tidak diketahui. Silakan pilih loader terlebih dahulu sebelum install.',
      },
      { status: 400 },
    );
  }

  const loaderKind = getLoaderKind(serverLoader);

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const mcVersion = checked.server.env?.MINECRAFT_VERSION?.trim() ?? '';

  try {
    const projectUrl = new URL(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`);
    const project = await modrinthJson<ModrinthProject>(projectUrl);

    const actualType = typeof project.project_type === 'string' ? project.project_type.toLowerCase() : '';
    const projectType = actualType || requestedType;
    if (!projectType || !(SUPPORTED_PROJECT_TYPES as readonly string[]).includes(projectType)) {
      return Response.json(
        {
          error: `Project Modrinth ini bertipe "${projectType || 'tidak diketahui'}" dan belum bisa di-install dari panel. Tipe yang didukung: ${SUPPORTED_PROJECT_TYPES.join(', ')}.`,
        },
        { status: 400 },
      );
    }

    if (loaderKind === 'plugin' && projectType === 'shader') {
      return Response.json(
        { error: 'Shader tidak didukung untuk plugin server (Paper/Spigot/Bukkit/Purpur).' },
        { status: 400 },
      );
    }

    const isJarProject = projectType === 'plugin' || projectType === 'mod';
    const versionLoaders: string[] = isJarProject
      ? loaderKind === 'plugin'
        ? [...PLUGIN_LOADERS]
        : [serverLoader]
      : [];

    const versions = await fetchModrinthVersions(projectId, mcVersion, versionLoaders);
    if (versions.length === 0) {
      const loaderLabel = versionLoaders.length > 0 ? ` untuk loader ${serverLoader}` : '';
      return Response.json(
        {
          error: `Tidak ada versi yang kompatibel${loaderLabel} di Modrinth`,
        },
        { status: 404 },
      );
    }

    // Prioritaskan requestedVersionId bila cocok, lalu versi yang secara eksplisit memuat serverLoader, lalu versi terbaru.
    const version =
      versions.find((item) => item.id === requestedVersionId) ??
      versions.find((item) =>
        Array.isArray(item.loaders) &&
        item.loaders.some((loader) => loader.toLowerCase() === serverLoader),
      ) ??
      versions[0];

    const allowedExtensions = getAllowedExtensions(loaderKind, projectType);
    const files = Array.isArray(version.files) ? version.files : [];
    const hasAllowedExtension = (filename?: string) => {
      const lower = (filename ?? '').toLowerCase();
      return allowedExtensions.some((ext) => lower.endsWith(ext));
    };
    const file =
      files.find((item) => item.primary && hasAllowedExtension(item.filename)) ??
      files.find((item) => hasAllowedExtension(item.filename));
    const filename = file?.filename ? safeFilename(file.filename, allowedExtensions) : null;
    if (!file?.url || !filename) {
      return Response.json(
        {
          error: `Versi Modrinth ini tidak memiliki file ${allowedExtensions.join('/')} yang valid`,
        },
        { status: 422 },
      );
    }

    const target = resolveTargetByServerLoader(loaderKind, projectType, filename);

    let fileUrl: URL;
    try {
      fileUrl = new URL(file.url);
    } catch {
      return Response.json({ error: 'URL file Modrinth tidak valid' }, { status: 502 });
    }
    // Batasi unduhan ke CDN resmi agar URL dari API tidak bisa dipakai sebagai SSRF.
    if (fileUrl.protocol !== 'https:' || fileUrl.hostname !== 'cdn.modrinth.com') {
      return Response.json({ error: 'Host file unduhan Modrinth tidak diizinkan' }, { status: 502 });
    }

    const contentType = filename.toLowerCase().endsWith('.jar') ? 'application/java-archive' : 'application/zip';
    const transferController = new AbortController();
    const timeout = setTimeout(() => transferController.abort(), 3 * 60 * 1000);
    try {
      const download = await fetch(fileUrl, {
        headers: { 'User-Agent': USER_AGENT },
        cache: 'no-store',
        signal: transferController.signal,
      });
      if (!download.ok || !download.body) {
        await download.body?.cancel().catch(() => undefined);
        return Response.json({ error: `Gagal mengunduh file dari Modrinth (${download.status})` }, { status: 502 });
      }
      if (new URL(download.url).hostname !== 'cdn.modrinth.com') {
        await download.body.cancel();
        return Response.json({ error: 'Redirect file Modrinth menuju host yang tidak diizinkan' }, { status: 502 });
      }

      const contentLengthHeader = download.headers.get('content-length');
      const contentLengthValue = contentLengthHeader ? Number(contentLengthHeader) : NaN;
      if (Number.isFinite(contentLengthValue) && contentLengthValue > MAX_DOWNLOAD_BYTES) {
        await download.body.cancel();
        return Response.json({ error: 'Ukuran file melebihi batas 100 MB' }, { status: 413 });
      }
      const contentLength = Number.isFinite(contentLengthValue) && contentLengthValue >= 0 ? contentLengthValue : null;
      const boundary = `----hyunkpanel-${randomUUID()}`;
      const multipartBody = multipartFileStream(download.body, boundary, filename, contentType, contentLength);
      const prefixLength = Buffer.byteLength(multipartHeader(boundary, filename, contentType));
      const suffixLength = Buffer.byteLength(`\r\n--${boundary}--\r\n`);

      // Buat folder tujuan (termasuk parent-nya) bila belum ada.
      await ensureDirectory(resolved.client, resolved.server.uuid, target.directory);

      const token = createUploadToken({
        nodeSecret: resolved.client.token,
        serverUuid: resolved.server.uuid,
        userUuid: user.id,
      });
      const uploadUrl = resolved.client.uploadFileUrl(token, target.directory);
      const headers: Record<string, string> = { 'Content-Type': `multipart/form-data; boundary=${boundary}` };
      if (contentLength !== null) headers['Content-Length'] = String(prefixLength + contentLength + suffixLength);

      const upload = await fetch(uploadUrl, {
        method: 'POST',
        headers,
        body: multipartBody,
        signal: transferController.signal,
        // Node fetch requires duplex for a request body backed by a live stream.
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      if (!upload.ok) {
        const details = (await upload.text().catch(() => '')).slice(0, 300);
        return Response.json(
          {
            error: `Wings gagal menyimpan ${target.label} di ${target.directory} (${upload.status})${details ? `: ${details}` : ''}`,
          },
          { status: 502 },
        );
      }

      return Response.json({
        ok: true,
        filename,
        directory: target.directory,
        project_type: projectType,
        loader: serverLoader,
        version_id: version.id ?? null,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Gagal memasang konten dari Modrinth' },
      { status: 502 },
    );
  }
}
