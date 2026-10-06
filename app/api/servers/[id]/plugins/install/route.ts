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

interface InstallTarget {
  /** Label untuk pesan error/UI. */
  label: string;
  /** Folder tujuan install di root server (dibuat otomatis bila belum ada). */
  directory: string;
  /** Loader yang relevan saat memfilter versi di Modrinth (kosong = tanpa filter loader). */
  loaders: string[];
  /** Ekstensi file yang diterima untuk tipe ini. */
  extensions: string[];
}

/** Semua tipe project Modrinth yang didukung panel + lokasi installnya. */
const INSTALL_TARGETS: Record<string, InstallTarget> = {
  plugin: { label: 'plugin', directory: '/plugins', loaders: ['paper', 'purpur', 'spigot', 'bukkit'], extensions: ['.jar'] },
  mod: { label: 'mod', directory: '/mods', loaders: ['fabric', 'forge', 'neoforge', 'quilt'], extensions: ['.jar'] },
  resourcepack: { label: 'resource pack', directory: '/resourcepacks', loaders: [], extensions: ['.zip'] },
  shader: { label: 'shader', directory: '/shaderpacks', loaders: [], extensions: ['.zip'] },
  datapack: { label: 'datapack', directory: '/world/datapacks', loaders: [], extensions: ['.zip'] },
};

type ModrinthFile = { url?: string; filename?: string; primary?: boolean };
type ModrinthVersion = { id?: string; files?: ModrinthFile[] };
type ModrinthProject = { project_type?: string };

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
  if (!checked.server.image.toLowerCase().includes('java')) {
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
  if (requestedType && !INSTALL_TARGETS[requestedType]) {
    return Response.json(
      {
        error: `Tipe project "${requestedType}" tidak didukung. Tipe yang didukung: ${Object.keys(INSTALL_TARGETS).join(', ')}. Modpack belum bisa di-install dari panel.`,
      },
      { status: 400 },
    );
  }

  const requestedLoader = typeof body?.loader === 'string' ? body.loader.trim().toLowerCase() : '';

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const mcVersion = checked.server.env?.MINECRAFT_VERSION?.trim() ?? '';

  try {
    const projectUrl = new URL(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`);
    const project = await modrinthJson<ModrinthProject>(projectUrl);

    // Tipe asli dari Modrinth adalah sumber kebenaran; tipe dari client hanya
    // dipakai sebagai fallback bila API tidak mengembalikannya.
    const actualType = typeof project.project_type === 'string' ? project.project_type : '';
    const projectType = actualType || requestedType;
    const target = projectType ? INSTALL_TARGETS[projectType] : undefined;
    if (!target) {
      return Response.json(
        {
          error: `Project Modrinth ini bertipe "${projectType || 'tidak diketahui'}" dan belum bisa di-install dari panel. Tipe yang didukung: ${Object.keys(INSTALL_TARGETS).join(', ')}.`,
        },
        { status: 400 },
      );
    }
    if (requestedType && requestedType !== projectType) {
      return Response.json(
        {
          error: `Tipe project tidak sesuai: request meminta "${requestedType}" tetapi project Modrinth ini adalah ${target.label}. Silakan install sesuai tipe aslinya.`,
        },
        { status: 400 },
      );
    }

    // Filter loader versi: hanya plugin & mod yang punya loader di Modrinth.
    let versionLoaders: string[] = target.loaders;
    if (requestedLoader) {
      if (!target.loaders.includes(requestedLoader)) {
        return Response.json(
          {
            error: target.loaders.length === 0
              ? `Tipe project ${target.label} tidak memakai loader, jadi filter loader "${requestedLoader}" tidak berlaku`
              : `Loader "${requestedLoader}" tidak valid untuk ${target.label}. Loader yang didukung: ${target.loaders.join(', ')}`,
          },
          { status: 400 },
        );
      }
      versionLoaders = [requestedLoader];
    }

    const versionsUrl = new URL(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version`);
    if (mcVersion && mcVersion.toLowerCase() !== 'latest') {
      versionsUrl.searchParams.set('game_versions', JSON.stringify([mcVersion]));
    }
    if (versionLoaders.length > 0) {
      versionsUrl.searchParams.set('loaders', JSON.stringify(versionLoaders));
    }

    const versions = await modrinthJson<ModrinthVersion[]>(versionsUrl);
    if (!Array.isArray(versions) || versions.length === 0) {
      const loaderNote = versionLoaders.length > 0 ? ` dan loader ${versionLoaders.join('/')}` : '';
      return Response.json(
        {
          error:
            mcVersion && mcVersion.toLowerCase() !== 'latest'
              ? `Tidak ada versi ${target.label} yang kompatibel dengan Minecraft ${mcVersion}${loaderNote}`
              : `Tidak ada versi ${target.label} yang kompatibel${loaderNote}`,
        },
        { status: 404 },
      );
    }

    // Gunakan versi pilihan bila memang kompatibel; jika tidak, ambil versi kompatibel terbaru.
    const version = versions.find((item) => item.id === requestedVersionId) ?? versions[0];
    const files = Array.isArray(version.files) ? version.files : [];
    const hasAllowedExtension = (filename?: string) => {
      const lower = (filename ?? '').toLowerCase();
      return target.extensions.some((ext) => lower.endsWith(ext));
    };
    const file = files.find((item) => item.primary && hasAllowedExtension(item.filename))
      ?? files.find((item) => hasAllowedExtension(item.filename));
    const filename = file?.filename ? safeFilename(file.filename, target.extensions) : null;
    if (!file?.url || !filename) {
      return Response.json(
        {
          error: `Versi Modrinth ini tidak memiliki file ${target.extensions.join('/')} yang valid untuk ${target.label}`,
        },
        { status: 422 },
      );
    }

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
