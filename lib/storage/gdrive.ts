import 'server-only';

/**
 * Google Drive storage provider.
 *
 * Direct upload memakai dua langkah agar file besar (bisa >1GB) tetap
 * ter-stream tanpa buffer di memory:
 *   1. POST /drive/v3/files (metadata: nama + folder parents) → dapat file ID
 *   2. PATCH /upload/drive/v3/files/{id}?uploadType=media (body = stream)
 *
 * Untuk backup yang di-offload, initGdriveResumableUpload() hanya membuat
 * session URL; byte backup dikirim langsung oleh VPS NAT.
 *
 * Folder tujuan: "Hyunk Panel Backups/{server_name}/" (dibuat otomatis).
 * Scope OAuth `drive.file` cukup — panel hanya bisa mengakses file/folder
 * yang dibuat oleh panel sendiri.
 */

export const GDRIVE_ROOT_FOLDER = 'Hyunk Panel Backups';

export interface GDriveUploadResult {
  fileId: string;
  fileName: string;
  size?: number;
}

export interface GDriveDownloadResult {
  stream: ReadableStream<Uint8Array>;
  size?: number;
}

interface DriveFileList {
  files?: Array<{ id: string; name: string }>;
}

interface DriveFile {
  id: string;
  name?: string;
}

interface DriveFileWithCreatedAt extends DriveFile {
  createdTime?: string;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function apiFetch(path: string, init: RequestInit & { token: string }): Promise<Response> {
  const { token, ...rest } = init;
  return fetch(`https://www.googleapis.com${path}`, {
    ...rest,
    headers: { Authorization: `Bearer ${token}`, ...(rest.headers ?? {}) },
    cache: 'no-store',
  });
}

/** Cari folder berdasarkan nama (di dalam parent bila ada); buat bila belum ada. */
async function ensureFolder(token: string, name: string, parentId?: string): Promise<string> {
  const q = [
    `name='${escapeDriveQueryValue(name)}'`,
    `mimeType='application/vnd.google-apps.folder'`,
    'trashed=false',
    ...(parentId ? [`'${parentId}' in parents`] : []),
  ].join(' and ');
  const res = await apiFetch(
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1&spaces=drive`,
    { token, method: 'GET' },
  );
  if (res.ok) {
    const json = (await res.json()) as DriveFileList;
    if (json.files?.length) return json.files[0].id;
  }
  const create = await apiFetch('/drive/v3/files', {
    token,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!create.ok) {
    throw new Error(`GDrive: gagal membuat folder "${name}" → ${create.status}: ${(await create.text().catch(() => '')).slice(0, 300)}`);
  }
  const file = (await create.json()) as DriveFile;
  return file.id;
}

/** Resolve the existing backup folder path without creating a file upload session. */
export async function getGDriveBackupFolderId(token: string, serverName: string): Promise<string> {
  const rootId = await ensureFolder(token, GDRIVE_ROOT_FOLDER);
  return ensureFolder(token, serverName, rootId);
}

/**
 * Create a Google Drive resumable upload session only. The backup bytes never
 * pass through the panel process; the returned Location URL is consumed by
 * the VPS NAT offload worker.
 */
export async function initGdriveResumableUpload(
  accessToken: string,
  filename: string,
  folderId: string,
  fileSizeBytes: number,
): Promise<string> {
  if (!filename.trim()) throw new Error('GDrive: nama file upload wajib diisi');
  if (!folderId.trim()) throw new Error('GDrive: folder ID upload wajib diisi');
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes < 0) {
    throw new Error('GDrive: ukuran file upload tidak valid');
  }

  const response = await apiFetch('/upload/drive/v3/files?uploadType=resumable', {
    token: accessToken,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': 'application/octet-stream',
      'X-Upload-Content-Length': String(fileSizeBytes),
    },
    body: JSON.stringify({ name: filename, parents: [folderId] }),
  });
  if (response.status !== 200) {
    const detail = (await response.text().catch(() => ''))
      .replaceAll(accessToken, '[redacted]')
      .slice(0, 300);
    throw new Error(`GDrive: gagal membuat resumable upload session → ${response.status}: ${detail}`);
  }

  const uploadUrl = response.headers.get('location');
  if (!uploadUrl) throw new Error('GDrive: response resumable upload tidak memiliki Location header');
  return uploadUrl;
}

/** Find the newest file with this name in a backup folder after offload. */
export async function findGDriveFileId(
  accessToken: string,
  filename: string,
  folderId: string,
): Promise<string | null> {
  const query = [
    `name='${escapeDriveQueryValue(filename)}'`,
    `'${escapeDriveQueryValue(folderId)}' in parents`,
    'trashed=false',
  ].join(' and ');
  const response = await apiFetch(
    `/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,createdTime)&orderBy=createdTime%20desc&pageSize=1&spaces=drive`,
    { token: accessToken, method: 'GET' },
  );
  if (!response.ok) {
    throw new Error(`GDrive: gagal mencari file hasil offload → ${response.status}`);
  }
  const result = (await response.json()) as { files?: DriveFileWithCreatedAt[] };
  return result.files?.[0]?.id ?? null;
}

/** Upload stream ke "Hyunk Panel Backups/{serverName}/{filename}". */
export async function uploadToGDrive(
  token: string,
  serverName: string,
  filename: string,
  stream: ReadableStream<Uint8Array>,
  size?: number,
): Promise<GDriveUploadResult> {
  const serverFolderId = await getGDriveBackupFolderId(token, serverName);

  // 1. Metadata file (dapat ID lebih dulu).
  const metaRes = await apiFetch('/drive/v3/files', {
    token,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: filename, parents: [serverFolderId] }),
  });
  if (!metaRes.ok) {
    throw new Error(`GDrive: gagal membuat metadata file → ${metaRes.status}: ${(await metaRes.text().catch(() => '')).slice(0, 300)}`);
  }
  const file = (await metaRes.json()) as DriveFile;

  // 2. Media — stream langsung, Content-Length bila ukuran diketahui.
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
  if (size !== undefined && Number.isFinite(size) && size >= 0) {
    headers['Content-Length'] = String(size);
  }
  const upRes = await apiFetch(`/upload/drive/v3/files/${file.id}?uploadType=media`, {
    token,
    method: 'PATCH',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit & { token: string; duplex: 'half' });
  if (!upRes.ok) {
    throw new Error(`GDrive: gagal upload media → ${upRes.status}: ${(await upRes.text().catch(() => '')).slice(0, 300)}`);
  }
  return { fileId: file.id, fileName: filename, size };
}

/** Test koneksi: baca info akun Google yang terhubung. */
export async function testGDrive(token: string): Promise<{ ok: boolean; message: string }> {
  const res = await apiFetch('/drive/v3/about?fields=user(displayName,emailAddress)', {
    token,
    method: 'GET',
  });
  if (!res.ok) {
    return { ok: false, message: `GDrive API → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` };
  }
  const json = (await res.json()) as { user?: { displayName?: string; emailAddress?: string } };
  const who = json.user?.emailAddress ?? json.user?.displayName ?? 'akun tidak diketahui';
  return { ok: true, message: `Terhubung sebagai ${who}` };
}

/** Hapus file berdasarkan file ID. */
export async function deleteGDriveFile(token: string, fileId: string): Promise<void> {
  const res = await apiFetch(`/drive/v3/files/${encodeURIComponent(fileId)}`, {
    token,
    method: 'DELETE',
  });
  // 404 = sudah hilang — dianggap sukses untuk keperluan retention.
  if (!res.ok && res.status !== 404) {
    throw new Error(`GDrive: gagal menghapus file → ${res.status}`);
  }
}

/** Download file dari Google Drive sebagai stream berdasarkan file ID (tanpa simpan ke disk). */
export async function downloadFromGDrive(
  token: string,
  fileId: string,
): Promise<GDriveDownloadResult> {
  const res = await apiFetch(
    `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { token, method: 'GET' },
  );
  if (!res.ok || !res.body) {
    throw new Error(
      `GDrive: gagal mengunduh file → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`,
    );
  }
  const len = Number(res.headers.get('content-length'));
  return {
    stream: res.body,
    size: Number.isFinite(len) && len > 0 ? len : undefined,
  };
}

export const downloadGDriveFile = downloadFromGDrive;

/** URL lihat file di Google Drive. */
export function getGDriveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}
