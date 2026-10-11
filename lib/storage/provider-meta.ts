import type { StorageProviderType } from '@/types';

/**
 * Metadata tampilan provider cloud storage — aman dipakai dari client component
 * (tidak mengimpor apa pun yang `server-only`).
 *
 * Dipakai bersama oleh halaman Storage dan halaman monitoring backup admin.
 */
export interface ProviderMeta {
  label: string;
  /** Inisial singkat untuk avatar/icon provider. */
  icon: string;
  /** Kelas Tailwind untuk badge/icon provider. */
  color: string;
}

export const PROVIDER_META: Record<StorageProviderType, ProviderMeta> = {
  gdrive: {
    label: 'Google Drive',
    icon: 'G',
    color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  dropbox: {
    label: 'Dropbox',
    icon: 'D',
    color: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  },
  onedrive: {
    label: 'OneDrive',
    icon: 'O',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  s3: {
    label: 'S3 Compatible',
    icon: 'S3',
    color: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
  sftp: {
    label: 'SFTP',
    icon: 'SF',
    color: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
  webdav: {
    label: 'WebDAV',
    icon: 'WD',
    color: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  },
};

/** Urutan provider yang stabil untuk dropdown filter. */
export const PROVIDER_ORDER: StorageProviderType[] = [
  'gdrive',
  'dropbox',
  'onedrive',
  's3',
  'sftp',
  'webdav',
];

export function providerLabel(type: string | null | undefined): string {
  if (!type) return '—';
  return PROVIDER_META[type as StorageProviderType]?.label ?? type;
}

export function isStorageProviderType(value: unknown): value is StorageProviderType {
  return typeof value === 'string' && value in PROVIDER_META;
}
