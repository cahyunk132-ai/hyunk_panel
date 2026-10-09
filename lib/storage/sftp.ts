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

/** Representasi URL untuk file SFTP. */
export function getSFTPFileUrl(config: SftpStorageConfig, path: string): string {
  return `sftp://${config.username}@${config.host}:${config.port || 22}${path.startsWith('/') ? path : `/${path}`}`;
}
