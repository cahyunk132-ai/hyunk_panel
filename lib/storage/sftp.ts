import 'server-only';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import SftpClient from 'ssh2-sftp-client';
import type { SftpStorageConfig } from '@/types';

/**
 * SFTP storage provider (library ssh2-sftp-client).
 *
 * Tujuan: {path}/{Hyunk Panel Backups}/{server_name}/{filename}
 * Stream langsung dari Wings → SFTP (put menerima Readable), tidak ada
 * buffer penuh di memory.
 */

export const SFTP_ROOT_FOLDER = 'Hyunk Panel Backups';

export interface SftpUploadResult {
  fileId: string;
  fileName: string;
  size?: number;
}

export interface SftpDownloadResult {
  stream: ReadableStream<Uint8Array>;
  size?: number;
}

function remoteDir(config: SftpStorageConfig, serverName: string): string {
  const base = (config.path || '/').replace(/\/+$/, '');
  return `${base}/${SFTP_ROOT_FOLDER}/${serverName}`;
}

function remotePath(config: SftpStorageConfig, serverName: string, filename: string): string {
  return `${remoteDir(config, serverName)}/${filename}`;
}

async function withSftp<T>(config: SftpStorageConfig, fn: (sftp: SftpClient) => Promise<T>): Promise<T> {
  const sftp = new SftpClient();
  await sftp.connect({
    host: config.host,
    port: config.port || 22,
    username: config.username,
    password: config.password,
  });
  try {
    return await fn(sftp);
  } finally {
    await sftp.end().catch(() => {});
  }
}

/** Upload stream ke server SFTP. */
export async function uploadToSFTP(
  config: SftpStorageConfig,
  serverName: string,
  filename: string,
  stream: ReadableStream<Uint8Array>,
  size?: number,
): Promise<SftpUploadResult> {
  const target = remotePath(config, serverName, filename);
  await withSftp(config, async (sftp) => {
    await sftp.mkdir(remoteDir(config, serverName), true).catch(() => {});
    await sftp.put(Readable.fromWeb(stream as unknown as WebReadableStream), target);
  });
  return { fileId: target, fileName: filename, size };
}

/** Test koneksi: connect + list direktori utama. */
export async function testSFTP(config: SftpStorageConfig): Promise<{ ok: boolean; message: string }> {
  try {
    return await withSftp(config, async (sftp) => {
      const base = (config.path || '/').replace(/\/+$/, '') || '/';
      const entries = await sftp.list(base);
      return { ok: true, message: `Terhubung ke ${config.host}:${config.port || 22} — ${entries.length} entri di ${base}` };
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Gagal koneksi SFTP' };
  }
}

/** Hapus file berdasarkan path lengkap. */
export async function deleteSFTPFile(config: SftpStorageConfig, path: string): Promise<void> {
  await withSftp(config, async (sftp) => {
    await sftp.delete(path).catch(() => {});
  });
}

/** Download file dari SFTP sebagai stream berdasarkan path lengkap (tanpa simpan ke disk). */
export async function downloadFromSFTP(
  config: SftpStorageConfig,
  path: string,
): Promise<SftpDownloadResult> {
  const sftp = new SftpClient();
  await sftp.connect({
    host: config.host,
    port: config.port || 22,
    username: config.username,
    password: config.password,
  });

  let size: number | undefined;
  try {
    const stat = await sftp.stat(path);
    if (typeof stat.size === 'number' && stat.size > 0) {
      size = stat.size;
    }
  } catch (err) {
    await sftp.end().catch(() => {});
    throw new Error(
      `SFTP: file tidak ditemukan atau tidak dapat diakses (${err instanceof Error ? err.message : path})`,
    );
  }

  const nodeStream = sftp.createReadStream(path) as unknown as Readable;
  const iterator = nodeStream[Symbol.asyncIterator]();
  let ended = false;
  const cleanup = async () => {
    if (ended) return;
    ended = true;
    nodeStream.destroy();
    await sftp.end().catch(() => {});
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          await cleanup();
          controller.close();
          return;
        }
        controller.enqueue(
          value instanceof Uint8Array ? value : new Uint8Array(Buffer.from(value as ArrayBuffer)),
        );
      } catch (err) {
        await cleanup();
        controller.error(err);
      }
    },
    async cancel() {
      await cleanup();
    },
  });

  return { stream, size };
}

export const downloadSFTPFile = downloadFromSFTP;

/** Representasi URL untuk file SFTP. */
export function getSFTPFileUrl(config: SftpStorageConfig, path: string): string {
  return `sftp://${config.username}@${config.host}:${config.port || 22}${path.startsWith('/') ? path : `/${path}`}`;
}
