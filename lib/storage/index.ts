import 'server-only';
import type {
  PublicStorageProvider,
  S3StorageConfig,
  SftpStorageConfig,
  StorageProviderRow,
  WebdavStorageConfig,
} from '@/types';
import { decryptSecret } from './crypto';
import { getValidAccessToken } from './tokens';
import * as gdrive from './gdrive';
import * as dropbox from './dropbox';
import * as s3 from './s3';
import * as sftp from './sftp';
import * as webdav from './webdav';

/**
 * Dispatcher cloud storage — satu pintu untuk semua provider.
 *
 * Konvensi path di semua provider:
 *   Hyunk Panel Backups/{server_name}/{filename}
 *
 * Kredensial (access token OAuth, S3 secret_key, SFTP/WebDAV password) selalu
 * didekripsi di sini (server-side) dan tidak pernah keluar dari server.
 */

export const CLOUD_ROOT_FOLDER = 'Hyunk Panel Backups';

export interface UploadResult {
  /** ID/path file di cloud storage (dipakai untuk delete saat retention). */
  fileId: string;
  fileName: string;
  size?: number;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
}

/** Sanitize nama server untuk dipakai di path/filename (spasi tetap diperbolehkan). */
export function sanitizePathSegment(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '');
  return cleaned || 'server';
}

/** Nama file backup: {server_name}-{YYYY-MM-DD_HH-mm}.tar.gz */
export function buildBackupFileName(serverName: string, date: Date = new Date()): string {
  const safe = sanitizePathSegment(serverName);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-');
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}`;
  return `${safe}-${stamp}_${time}.tar.gz`;
}

/** Strip secret dari config sebelum dikirim ke browser. */
export function toPublicProvider(
  provider: StorageProviderRow,
  schedulesCount = 0,
): PublicStorageProvider {
  const configPublic: Record<string, unknown> = { ...(provider.config ?? {}) };
  delete configPublic.secret_key;
  delete configPublic.password;
  return {
    id: provider.id,
    provider: provider.provider,
    name: provider.name,
    is_active: provider.is_active,
    created_at: provider.created_at,
    config_public: configPublic,
    schedules_count: schedulesCount,
  };
}

function getS3Config(provider: StorageProviderRow): S3StorageConfig {
  const c = provider.config as Partial<S3StorageConfig>;
  if (!c.bucket || !c.access_key || !c.secret_key) {
    throw new Error('Konfigurasi S3 tidak lengkap (bucket/access_key/secret_key)');
  }
  return {
    bucket: c.bucket,
    region: c.region || 'us-east-1',
    access_key: c.access_key,
    secret_key: decryptSecret(c.secret_key),
    endpoint: c.endpoint || undefined,
  };
}

function getSftpConfig(provider: StorageProviderRow): SftpStorageConfig {
  const c = provider.config as Partial<SftpStorageConfig>;
  if (!c.host || !c.username || !c.password) {
    throw new Error('Konfigurasi SFTP tidak lengkap (host/username/password)');
  }
  return {
    host: c.host,
    port: c.port || 22,
    username: c.username,
    password: decryptSecret(c.password),
    path: c.path || '/',
  };
}

function getWebdavConfig(provider: StorageProviderRow): WebdavStorageConfig {
  const c = provider.config as Partial<WebdavStorageConfig>;
  if (!c.url || !c.username || !c.password) {
    throw new Error('Konfigurasi WebDAV tidak lengkap (url/username/password)');
  }
  return { url: c.url, username: c.username, password: decryptSecret(c.password) };
}

/** Upload stream backup ke provider. `serverName` dipakai sebagai sub-folder. */
export async function uploadToProvider(
  provider: StorageProviderRow,
  serverName: string,
  filename: string,
  stream: ReadableStream<Uint8Array>,
  size?: number,
): Promise<UploadResult> {
  const serverFolder = sanitizePathSegment(serverName);
  switch (provider.provider) {
    case 'gdrive':
      return gdrive.uploadToGDrive(await getValidAccessToken(provider), serverFolder, filename, stream, size);
    case 'dropbox':
      return dropbox.uploadToDropbox(await getValidAccessToken(provider), serverFolder, filename, stream, size);
    case 's3':
      return s3.uploadToS3(getS3Config(provider), serverFolder, filename, stream, size);
    case 'sftp':
      return sftp.uploadToSFTP(getSftpConfig(provider), serverFolder, filename, stream, size);
    case 'webdav':
      return webdav.uploadToWebDAV(getWebdavConfig(provider), serverFolder, filename, stream, size);
    case 'onedrive':
      throw new Error('OneDrive belum didukung (coming soon)');
    default:
      throw new Error(`Provider storage tidak dikenal: ${provider.provider}`);
  }
}

/** Test koneksi provider (dipakai tombol Test di halaman Storage). */
export async function testProvider(provider: StorageProviderRow): Promise<ProviderTestResult> {
  try {
    switch (provider.provider) {
      case 'gdrive':
        return await gdrive.testGDrive(await getValidAccessToken(provider));
      case 'dropbox':
        return await dropbox.testDropbox(await getValidAccessToken(provider));
      case 's3':
        return await s3.testS3(getS3Config(provider));
      case 'sftp':
        return await sftp.testSFTP(getSftpConfig(provider));
      case 'webdav':
        return await webdav.testWebDAV(getWebdavConfig(provider));
      case 'onedrive':
        return { ok: false, message: 'OneDrive belum didukung (coming soon)' };
      default:
        return { ok: false, message: `Provider tidak dikenal: ${provider.provider}` };
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Error tidak diketahui' };
  }
}

/** Hapus file di cloud berdasarkan storage_file_id (dipakai retention). */
export async function deleteFromProvider(provider: StorageProviderRow, fileId: string): Promise<void> {
  switch (provider.provider) {
    case 'gdrive':
      return gdrive.deleteGDriveFile(await getValidAccessToken(provider), fileId);
    case 'dropbox':
      return dropbox.deleteDropboxFile(await getValidAccessToken(provider), fileId);
    case 's3':
      return s3.deleteS3Object(getS3Config(provider), fileId);
    case 'sftp':
      return sftp.deleteSFTPFile(getSftpConfig(provider), fileId);
    case 'webdav':
      return webdav.deleteWebDAVFile(getWebdavConfig(provider), fileId);
    case 'onedrive':
      throw new Error('OneDrive belum didukung (coming soon)');
    default:
      throw new Error(`Provider storage tidak dikenal: ${provider.provider}`);
  }
}

/** URL download file di cloud (untuk kolom link di Backup History). */
export function getProviderFileUrl(provider: StorageProviderRow, fileId: string): string | null {
  try {
    switch (provider.provider) {
      case 'gdrive':
        return gdrive.getGDriveFileUrl(fileId);
      case 'dropbox':
        return dropbox.getDropboxFileUrl(fileId);
      case 's3':
        return s3.getS3FileUrl(getS3Config(provider), fileId);
      case 'sftp':
        return sftp.getSFTPFileUrl(getSftpConfig(provider), fileId);
      case 'webdav':
        return webdav.getWebDAVFileUrl(getWebdavConfig(provider), fileId);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
