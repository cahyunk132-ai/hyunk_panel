import 'server-only';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createClient, type WebDAVClient } from 'webdav';
import type { WebdavStorageConfig } from '@/types';

/**
 * WebDAV storage provider (library webdav).
 *
 * Tujuan: {url}/Hyunk Panel Backups/{server_name}/{filename}
 * Stream langsung dari Wings → WebDAV (putFileContents menerima Readable).
 */

export const WEBDAV_ROOT_FOLDER = 'Hyunk Panel Backups';

export interface WebdavUploadResult {
  fileId: string;
  fileName: string;
  size?: number;
}

function clientFor(config: WebdavStorageConfig): WebDAVClient {
  return createClient(config.url.replace(/\/+$/, ''), {
    username: config.username,
    password: config.password,
  });
}

function remotePath(serverName: string, filename: string): string {
  return `/${WEBDAV_ROOT_FOLDER}/${serverName}/${filename}`;
}

/** Upload stream ke server WebDAV. */
export async function uploadToWebDAV(
  config: WebdavStorageConfig,
  serverName: string,
  filename: string,
  stream: ReadableStream<Uint8Array>,
  size?: number,
): Promise<WebdavUploadResult> {
  const client = clientFor(config);
  const target = remotePath(serverName, filename);
  const dir = `/${WEBDAV_ROOT_FOLDER}/${serverName}`;
  await client.createDirectory(dir, { recursive: true }).catch(() => {});
  await client.putFileContents(target, Readable.fromWeb(stream as unknown as WebReadableStream), {
    overwrite: true,
  });
  return { fileId: target, fileName: filename, size };
}

/** Test koneksi: PROPFIND (getDirectoryContents) ke root. */
export async function testWebDAV(config: WebdavStorageConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const client = clientFor(config);
    const entries = await client.getDirectoryContents('/');
    const list = Array.isArray(entries) ? entries : [];
    return { ok: true, message: `Terhubung ke ${config.url} — ${list.length} entri di root` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Gagal koneksi WebDAV' };
  }
}

/** Hapus file berdasarkan path. */
export async function deleteWebDAVFile(config: WebdavStorageConfig, path: string): Promise<void> {
  const client = clientFor(config);
  await client.deleteFile(path).catch(() => {});
}

/** URL langsung ke file WebDAV. */
export function getWebDAVFileUrl(config: WebdavStorageConfig, path: string): string {
  const base = config.url.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
