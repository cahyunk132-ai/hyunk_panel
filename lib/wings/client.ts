/**
 * WingsClient — SATU-SATUNYA tempat kode panel boleh memanggil Wings API.
 *
 * Semua fungsi menerima `node` dari database. Token didekripsi di server-side
 * (API route) dan TIDAK PERNAH keluar ke browser — kecuali sebagai JWT
 * sementara yang ditandatangani (lihat lib/wings/jwt.ts).
 *
 * Endpoint diverifikasi terhadap source wings resmi
 * (github.com/pterodactyl/wings, router/*.go). Jangan menambah endpoint
 * yang tidak ada di sana.
 */

import { decryptToken } from './crypto';
import type {
  WingsFileStat,
  WingsResourceUsage,
  WingsServerAPIResponse,
  WingsSystemInformationV2,
} from './types';

export interface WingsNode {
  fqdn: string;
  port: number;
  token_id: string;
  token_encrypted: string;
}

export class WingsError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WingsError';
  }
}

export class WingsClient {
  private readonly baseUrl: string;
  /** Token node (plaintext) — hanya hidup di memori server API route. */
  readonly token: string;

  constructor(node: WingsNode) {
    this.baseUrl = `https://${node.fqdn}:${node.port}`;
    this.token = decryptToken(node.token_encrypted);
  }

  /** Base URL publik node (dipakai untuk membangun URL websocket & signed download). */
  get publicUrl(): string {
    return this.baseUrl;
  }

  get websocketBase(): string {
    return this.baseUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  }

  private async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Wings v1 tidak punya cache; jangan biarkan fetch men-cache apapun.
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new WingsError(res.status, `Wings ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
    }
    if (res.status === 204 || res.status === 202) {
      return undefined as T;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }
    return undefined as T;
  }

  // ── System / Node ────────────────────────────────────────────────────────

  /** GET /api/system?v=2 — info CPU/RAM/disk node. */
  async getSystemInformation(): Promise<WingsSystemInformationV2> {
    return this.request<WingsSystemInformationV2>('GET', '/api/system?v=2');
  }

  /** GET /api/servers — semua server yang dikenal wings + state & utilization live. */
  async getServers(): Promise<WingsServerAPIResponse[]> {
    const list = await this.request<WingsServerAPIResponse[]>('GET', '/api/servers');
    return Array.isArray(list) ? list : [];
  }

  /** GET /api/servers/{uuid} — detail satu server dari wings. */
  async getServer(serverUuid: string): Promise<WingsServerAPIResponse> {
    return this.request<WingsServerAPIResponse>('GET', `/api/servers/${serverUuid}`);
  }

  // ── Power & commands ─────────────────────────────────────────────────────

  async setPower(
    serverUuid: string,
    action: 'start' | 'stop' | 'restart' | 'kill',
    waitSeconds?: number,
  ): Promise<void> {
    await this.request('POST', `/api/servers/${serverUuid}/power`, {
      action,
      ...(waitSeconds !== undefined ? { wait_seconds: waitSeconds } : {}),
    });
  }

  async sendCommands(serverUuid: string, commands: string[]): Promise<void> {
    await this.request('POST', `/api/servers/${serverUuid}/commands`, { commands });
  }

  // ── Resources (snapshot via getServer) ───────────────────────────────────

  async getResources(serverUuid: string): Promise<{
    state: string;
    is_suspended: boolean;
    utilization: WingsResourceUsage['resources'] | WingsServerAPIResponse['utilization'];
  }> {
    const s = await this.getServer(serverUuid);
    return { state: s.state, is_suspended: s.is_suspended, utilization: s.utilization };
  }

  /** GET /api/servers/{uuid}/logs?size=100 — fallback log tanpa websocket. */
  async getLogs(serverUuid: string, size = 100): Promise<{ data: string[] }> {
    return this.request<{ data: string[] }>(
      'GET',
      `/api/servers/${serverUuid}/logs?size=${Math.min(size, 100)}`,
    );
  }

  // ── Files ────────────────────────────────────────────────────────────────

  /** GET /api/servers/{uuid}/files/list-directory?directory= */
  async listFiles(serverUuid: string, directory: string): Promise<WingsFileStat[]> {
    const list = await this.request<WingsFileStat[]>(
      'GET',
      `/api/servers/${serverUuid}/files/list-directory?directory=${encodeURIComponent(directory || '/')}`,
    );
    return Array.isArray(list) ? list : [];
  }

  /** GET /api/servers/{uuid}/files/contents?file= — raw body (bukan JSON). */
  async getFileContents(serverUuid: string, file: string): Promise<string> {
    const res = await fetch(
      `${this.baseUrl}/api/servers/${serverUuid}/files/contents?file=${encodeURIComponent(file)}`,
      { headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/plain' }, cache: 'no-store' },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new WingsError(res.status, `Wings GET contents → ${res.status}: ${text.slice(0, 400)}`);
    }
    return res.text();
  }

  /** POST /api/servers/{uuid}/files/write?file= — raw string body. */
  async writeFile(serverUuid: string, file: string, content: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/servers/${serverUuid}/files/write?file=${encodeURIComponent(file)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'text/plain',
          'Content-Length': String(Buffer.byteLength(content, 'utf8')),
        },
        body: content,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new WingsError(res.status, `Wings POST write → ${res.status}: ${text.slice(0, 400)}`);
    }
  }

  /** POST /api/servers/{uuid}/files/delete — { root, files: [] } */
  async deleteFiles(serverUuid: string, root: string, files: string[]): Promise<void> {
    await this.request('POST', `/api/servers/${serverUuid}/files/delete`, { root, files });
  }

  /** PUT /api/servers/{uuid}/files/rename — { root, files: [{from,to}] } */
  async renameFile(
    serverUuid: string,
    root: string,
    files: Array<{ from: string; to: string }>,
  ): Promise<void> {
    await this.request('PUT', `/api/servers/${serverUuid}/files/rename`, { root, files });
  }

  /** POST /api/servers/{uuid}/files/copy — { location } */
  async copyFile(serverUuid: string, location: string): Promise<void> {
    await this.request('POST', `/api/servers/${serverUuid}/files/copy`, { location });
  }

  /** POST /api/servers/{uuid}/files/create-directory — { name, path } */
  async createDirectory(serverUuid: string, path: string, name: string): Promise<void> {
    await this.request('POST', `/api/servers/${serverUuid}/files/create-directory`, { name, path });
  }

  /** POST /api/servers/{uuid}/files/compress — { root, files } → { file } */
  async compressFiles(
    serverUuid: string,
    root: string,
    files: string[],
  ): Promise<{ file: string }> {
    return this.request<{ file: string }>('POST', `/api/servers/${serverUuid}/files/compress`, {
      root,
      files,
    });
  }

  /** POST /api/servers/{uuid}/files/decompress — { root, file } */
  async decompressFile(serverUuid: string, root: string, file: string): Promise<void> {
    await this.request('POST', `/api/servers/${serverUuid}/files/decompress`, { root, file });
  }

  // ── Backups ──────────────────────────────────────────────────────────────

  /** POST /api/servers/{uuid}/backup — adapter "wings" = simpan lokal di node. */
  async createBackup(
    serverUuid: string,
    backupUuid: string,
    ignoredFiles = '',
  ): Promise<void> {
    await this.request('POST', `/api/servers/${serverUuid}/backup`, {
      adapter: 'wings',
      uuid: backupUuid,
      ignored_files: ignoredFiles,
    });
  }

  /** DELETE /api/servers/{uuid}/backup/{backup} */
  async deleteBackup(serverUuid: string, backupUuid: string): Promise<void> {
    await this.request('DELETE', `/api/servers/${serverUuid}/backup/${backupUuid}`);
  }

  /** POST /api/servers/{uuid}/backup/{backup}/restore — truncate sebelum restore. */
  async restoreBackup(serverUuid: string, backupUuid: string, truncate = false): Promise<void> {
    const qs = truncate ? '?truncate=true' : '';
    await this.request('POST', `/api/servers/${serverUuid}/backup/${backupUuid}/restore${qs}`);
  }

  // ── Lifecycle server ─────────────────────────────────────────────────────

  /**
   * POST /api/servers — wings HANYA menerima {uuid, start_on_completion} lalu
   * mengambil konfigurasi penuh dari Remote API panel (Phase 1b harus aktif).
   */
  async provisionServer(serverUuid: string, startOnCompletion = false): Promise<void> {
    await this.request('POST', '/api/servers', {
      uuid: serverUuid,
      start_on_completion: startOnCompletion,
    });
  }

  /** DELETE /api/servers/{uuid} — menghapus container + VOLUME DATA di node. Berbahaya. */
  async destroyServer(serverUuid: string): Promise<void> {
    await this.request('DELETE', `/api/servers/${serverUuid}`);
  }

  // ── WebSocket URL ────────────────────────────────────────────────────────

  /**
   * Wings TIDAK menerbitkan token WS. Panel menandatangani JWT sendiri
   * (HS256 dengan token node sebagai secret) — lihat lib/wings/jwt.ts.
   * Fungsi ini hanya membangun URL socket.
   */
  websocketUrl(serverUuid: string): string {
    return `${this.websocketBase}/api/servers/${serverUuid}/ws`;
  }

  downloadFileUrl(token: string): string {
    return `${this.baseUrl}/download/file?token=${encodeURIComponent(token)}`;
  }

  uploadFileUrl(token: string, directory: string): string {
    return `${this.baseUrl}/upload/file?token=${encodeURIComponent(token)}&directory=${encodeURIComponent(directory || '/')}`;
  }

  downloadBackupUrl(token: string): string {
    return `${this.baseUrl}/download/backup?token=${encodeURIComponent(token)}`;
  }
}
