import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings } from '@/lib/wings/resolve';
import { createUploadToken } from '@/lib/wings/jwt';

export const runtime = 'nodejs';

const MODRINTH_API = 'https://api.modrinth.com/v2';
const MODRINTH_LOADERS = ['paper', 'purpur', 'spigot', 'bukkit'];
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const USER_AGENT = 'HyunkPanel/0.1 (Modrinth plugin installer)';

type ModrinthFile = { url?: string; filename?: string; primary?: boolean };
type ModrinthVersion = { id?: string; files?: ModrinthFile[] };
type ModrinthProject = { project_type?: string };

function safeJarFilename(value: string): string | null {
  const name = value.replace(/[\\/\0]/g, '_').replace(/[^A-Za-z0-9._ -]/g, '_').trim();
  if (!name || name === '.' || name === '..' || name.length > 180 || !name.toLowerCase().endsWith('.jar')) {
    return null;
  }
  return name;
}

async function modrinthJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'Plugin atau versi Modrinth tidak ditemukan' : `Modrinth API error (${response.status})`);
  }
  return (await response.json()) as T;
}

/**
 * Download file dari CDN lalu teruskan sebagai multipart stream ke Wings.
 * Tidak pernah meng-buffer keseluruhan file ke dalam memory.
 */
function multipartFileStream(
  fileBody: ReadableStream<Uint8Array>,
  boundary: string,
  filename: string,
  expectedBytes: number | null,
): ReadableStream<Uint8Array> {
  const reader = fileBody.getReader();
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: application/java-archive\r\n\r\n`,
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
            controller.error(new Error('Unduhan plugin terputus sebelum selesai'));
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
          controller.error(new Error('Ukuran file plugin melebihi batas 100 MB'));
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

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;
  if (!checked.server.image.toLowerCase().includes('java')) {
    return Response.json({ error: 'Plugin hanya didukung untuk server Java Edition' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { project_id?: unknown; version_id?: unknown; file_url?: unknown; filename?: unknown }
    | null;
  const projectId = typeof body?.project_id === 'string' ? body.project_id.trim() : '';
  const requestedVersionId = typeof body?.version_id === 'string' ? body.version_id.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId)) {
    return Response.json({ error: 'Project Modrinth tidak valid' }, { status: 400 });
  }

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const mcVersion = checked.server.env?.MINECRAFT_VERSION?.trim() ?? '';
  const versionsUrl = new URL(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version`);
  if (mcVersion && mcVersion.toLowerCase() !== 'latest') {
    versionsUrl.searchParams.set('game_versions', JSON.stringify([mcVersion]));
  }
  versionsUrl.searchParams.set('loaders', JSON.stringify(MODRINTH_LOADERS));

  try {
    const projectUrl = new URL(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`);
    const project = await modrinthJson<ModrinthProject>(projectUrl);
    if (project.project_type !== 'plugin') {
      return Response.json({ error: 'Project Modrinth ini bukan plugin' }, { status: 400 });
    }

    const versions = await modrinthJson<ModrinthVersion[]>(versionsUrl);
    if (!Array.isArray(versions) || versions.length === 0) {
      return Response.json(
        { error: mcVersion && mcVersion.toLowerCase() !== 'latest'
          ? `Tidak ada versi plugin yang kompatibel dengan Minecraft ${mcVersion} dan loader yang didukung`
          : 'Tidak ada versi plugin yang kompatibel dengan loader yang didukung' },
        { status: 404 },
      );
    }

    // Gunakan versi pilihan bila memang kompatibel; jika tidak, ambil versi kompatibel terbaru.
    const version = versions.find((item) => item.id === requestedVersionId) ?? versions[0];
    const files = Array.isArray(version.files) ? version.files : [];
    const file = files.find((item) => item.primary && item.filename?.toLowerCase().endsWith('.jar'))
      ?? files.find((item) => item.filename?.toLowerCase().endsWith('.jar'));
    const filename = file?.filename ? safeJarFilename(file.filename) : null;
    if (!file?.url || !filename) {
      return Response.json({ error: 'Versi Modrinth tidak memiliki file JAR yang valid' }, { status: 422 });
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
        return Response.json({ error: 'Ukuran file plugin melebihi batas 100 MB' }, { status: 413 });
      }
      const contentLength = Number.isFinite(contentLengthValue) && contentLengthValue >= 0 ? contentLengthValue : null;
      const boundary = `----hyunkpanel-${randomUUID()}`;
      const multipartBody = multipartFileStream(download.body, boundary, filename, contentLength);
      const prefixLength = Buffer.byteLength(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: application/java-archive\r\n\r\n`,
      );
      const suffixLength = Buffer.byteLength(`\r\n--${boundary}--\r\n`);
      const rootFiles = await resolved.client.listFiles(resolved.server.uuid, '/');
      if (!rootFiles.some((entry) => entry.name === 'plugins' && entry.directory)) {
        await resolved.client.createDirectory(resolved.server.uuid, '/', 'plugins');
      }

      const token = createUploadToken({
        nodeSecret: resolved.client.token,
        serverUuid: resolved.server.uuid,
        userUuid: user.id,
      });
      const uploadUrl = resolved.client.uploadFileUrl(token, '/plugins');
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
          { error: `Wings gagal menyimpan plugin (${upload.status})${details ? `: ${details}` : ''}` },
          { status: 502 },
        );
      }

      return Response.json({ ok: true, filename, version_id: version.id ?? null });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Gagal memasang plugin' },
      { status: 502 },
    );
  }
}
