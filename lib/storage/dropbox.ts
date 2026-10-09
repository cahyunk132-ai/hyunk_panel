import 'server-only';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/**
 * Dropbox storage provider.
 *
 * - File ≤ 150 MB → simple upload (POST /2/files/upload), stream langsung,
 *   Content-Length wajib (diketahui dari laporan ukuran backup Wings).
 * - File > 150 MB → upload session (start → append_v2* → finish) dengan chunk
 *   48 MB. Hanya satu chunk yang di-buffer pada satu waktu (bukan seluruh
 *   file) sehingga file >1GB tetap aman di memory serverless.
 *
 * Path tujuan: /Hyunk Panel Backups/{server_name}/{filename}
 */

export const DROPBOX_ROOT_FOLDER = 'Hyunk Panel Backups';

/** Batas resmi simple upload Dropbox. */
const SIMPLE_UPLOAD_LIMIT = 150 * 1024 * 1024;
/** Ukuran chunk upload session (Dropbox merekomendasikan ≤ 150MB per chunk). */
const SESSION_CHUNK_SIZE = 48 * 1024 * 1024;

export interface DropboxUploadResult {
  fileId: string;
  fileName: string;
  size?: number;
}

function dropboxPath(serverName: string, filename: string): string {
  const seg = (s: string) => encodeURIComponent(s);
  return `/${DROPBOX_ROOT_FOLDER}/${seg(serverName)}/${seg(filename)}`;
}

function toNodeStream(stream: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(stream as unknown as WebReadableStream);
}

/** Gabungkan stream menjadi chunk berukuran tetap (buffer hanya 1 chunk). */
async function* chunked(stream: Readable, size: number): AsyncGenerator<Buffer> {
  let parts: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    const b = Buffer.from(chunk as Uint8Array);
    parts.push(b);
    length += b.length;
    if (length >= size) {
      const out = Buffer.concat(parts);
      const remainder = out.subarray(size);
      yield out.subarray(0, size);
      parts = remainder.length > 0 ? [Buffer.from(remainder)] : [];
      length = remainder.length;
    }
  }
  if (length > 0) yield Buffer.concat(parts);
}

async function dropboxContentRpc(
  path: string,
  token: string,
  arg: Record<string, unknown>,
  body: BodyInit | Buffer,
): Promise<Response> {
  return fetch(`https://content.dropboxapi.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify(arg),
    },
    body: body as BodyInit,
    cache: 'no-store',
  });
}

/** Upload via upload session untuk file >150MB (atau ukuran tidak diketahui). */
async function uploadSession(
  token: string,
  path: string,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const commit = { path, mode: 'add', autorename: false, mute: true };
  const iterator = chunked(toNodeStream(stream), SESSION_CHUNK_SIZE);

  let sessionId: string | null = null;
  let offset = 0;
  let pending = await iterator.next();
  let started = false;

  try {
    while (!pending.done) {
      // Buffer chunk berikutnya dulu untuk tahu apakah ini chunk terakhir.
      const buf = pending.value;
      const next = await iterator.next();
      const isLast = next.done;

      if (!started) {
        const res = await dropboxContentRpc('/2/files/upload_session/start', token, { close: false }, buf);
        if (!res.ok) {
          throw new Error(`Dropbox upload_session/start → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
        }
        const json = (await res.json()) as { session_id?: string };
        if (!json.session_id) throw new Error('Dropbox tidak mengembalikan session_id');
        sessionId = json.session_id;
        offset = buf.length;
        started = true;
      } else if (isLast) {
        const res = await dropboxContentRpc(
          '/2/files/upload_session/finish',
          token,
          { cursor: { session_id: sessionId, offset }, commit },
          buf,
        );
        if (!res.ok) {
          throw new Error(`Dropbox upload_session/finish → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
        }
        offset += buf.length;
      } else {
        const res = await dropboxContentRpc(
          '/2/files/upload_session/append_v2',
          token,
          { cursor: { session_id: sessionId, offset }, close: false },
          buf,
        );
        if (!res.ok) {
          throw new Error(`Dropbox upload_session/append_v2 → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
        }
        offset += buf.length;
      }
      pending = next;
    }

    // Stream kosong (file 0 byte) — tetap harus memulai & menyelesaikan session.
    if (!started) {
      const startRes = await dropboxContentRpc('/2/files/upload_session/start', token, { close: true }, Buffer.alloc(0));
      if (!startRes.ok) throw new Error(`Dropbox upload_session/start → ${startRes.status}`);
      const json = (await startRes.json()) as { session_id?: string };
      const finishRes = await dropboxContentRpc(
        '/2/files/upload_session/finish',
        token,
        { cursor: { session_id: json.session_id, offset: 0 }, commit },
        Buffer.alloc(0),
      );
      if (!finishRes.ok) throw new Error(`Dropbox upload_session/finish → ${finishRes.status}`);
    }
  } finally {
    await iterator.return?.(undefined).catch(() => {});
  }
}

/** Upload stream ke /Hyunk Panel Backups/{serverName}/{filename}. */
export async function uploadToDropbox(
  token: string,
  serverName: string,
  filename: string,
  stream: ReadableStream<Uint8Array>,
  size?: number,
): Promise<DropboxUploadResult> {
  const path = dropboxPath(serverName, filename);

  // Simple upload butuh Content-Length — hanya dipakai bila ukuran diketahui.
  if (size !== undefined && Number.isFinite(size) && size <= SIMPLE_UPLOAD_LIMIT) {
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(size),
        'Dropbox-API-Arg': JSON.stringify({ path, mode: 'add', autorename: false, mute: true }),
      },
      body: stream,
      cache: 'no-store',
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    if (!res.ok) {
      throw new Error(`Dropbox upload → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    }
    return { fileId: path, fileName: filename, size };
  }

  await uploadSession(token, path, stream);
  return { fileId: path, fileName: filename, size };
}

/** Test koneksi: baca akun Dropbox yang terhubung. */
export async function testDropbox(token: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: 'null',
    cache: 'no-store',
  });
  if (!res.ok) {
    return { ok: false, message: `Dropbox API → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` };
  }
  const json = (await res.json()) as { email?: string; name?: { display_name?: string } };
  const who = json.email ?? json.name?.display_name ?? 'akun tidak diketahui';
  return { ok: true, message: `Terhubung sebagai ${who}` };
}

/** Hapus file berdasarkan path. */
export async function deleteDropboxFile(token: string, path: string): Promise<void> {
  const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300);
    // path_lookup/not_found → sudah hilang, dianggap sukses untuk retention.
    if (!text.includes('not_found')) {
      throw new Error(`Dropbox: gagal menghapus file → ${res.status}: ${text}`);
    }
  }
}

/** Perkiraan URL file di web Dropbox. */
export function getDropboxFileUrl(path: string): string {
  return `https://www.dropbox.com/home${path.startsWith('/') ? path : `/${path}`}`;
}
