// ─── Tipe domain Hyunk Panel (mirror skema Supabase) ────────────────────────

export type UserRole = 'owner_panel' | 'admin' | 'moderator' | 'user' | 'subuser';

export type ServerStatus =
  | 'running'
  | 'starting'
  | 'stopping'
  | 'offline'
  | 'installing'
  | 'error';

export type PowerAction = 'start' | 'stop' | 'restart' | 'kill';

export type ServerPermission =
  | 'start'
  | 'stop'
  | 'restart'
  | 'kill'
  | 'console'
  | 'console.send'
  | 'files'
  | 'files.read'
  | 'files.edit'
  | 'backups'
  | 'backup.restore'
  | 'backups.delete'
  | 'backup.schedule'
  | 'players'
  | 'monitoring'
  | 'settings';

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  created_at: string;
}

export interface NodeRow {
  id: string;
  name: string;
  fqdn: string;
  port: number;
  token_id: string;
  token_encrypted: string;
  uuid: string;
  location: string;
  memory_total_mb: number | null;
  disk_total_mb: number | null;
  is_maintenance: boolean;
  created_at: string;
}

/** Node tanpa kolom sensitif — aman dikirim ke browser. */
export type PublicNode = Omit<NodeRow, 'token_encrypted'>;

export interface AllocationRow {
  id: string;
  node_id: string;
  ip: string;
  port: number;
  assigned_to: string | null;
  created_at: string;
}

/** Allocation + server yang memakainya (untuk section Port di halaman node). */
export interface NodeAllocation extends AllocationRow {
  server: { id: string; name: string } | null;
}

/** Ringkasan jumlah allocation pada satu node. */
export interface NodeAllocationStats {
  total: number;
  available: number;
  assigned: number;
}

export interface ServerRow {
  id: string;
  uuid: string;
  name: string;
  node_id: string;
  owner_id: string | null;
  allocation_id: string | null;
  memory_mb: number;
  cpu_limit: number;
  disk_mb: number | null;
  image: string;
  startup: string;
  env: Record<string, string>;
  /** Local Egg template selection; runtime configuration remains image/startup/env. */
  egg_id?: string | null;
  egg_version_id?: string | null;
  status: ServerStatus;
  is_suspended: boolean;
  created_at: string;
}

export interface EggRow {
  id: string;
  name: string;
  description: string | null;
  docker_image: string;
  startup: string;
  config_stop: string | null;
  config_startup: Record<string, unknown>;
  env_variables: unknown[];
  features: string[];
  created_by: string | null;
  created_at: string;
}

export interface EggVersionRow {
  id: string;
  egg_id: string;
  name: string;
  minecraft_version: string | null;
  docker_image: string | null;
  env_overrides: Record<string, string>;
  is_recommended: boolean;
  sort_order: number;
  created_at: string;
  // ── Generic Auto Download System (migration 004) ──
  download_provider: DownloadProvider;
  download_url_template: string | null;
  download_variables: Record<string, string>;
  download_filename: string | null;
  download_executable: boolean;
}

export type DownloadProvider =
  | 'none'
  | 'paper'
  | 'purpur'
  | 'vanilla'
  | 'fabric'
  | 'forge'
  | 'neoforge'
  | 'quilt'
  | 'bedrock'
  | 'custom';

export interface NodeEggRow {
  node_id: string;
  egg_id: string;
}

export interface ServerUserRow {
  server_id: string;
  user_id: string;
  role: 'user' | 'subuser';
  permissions: ServerPermission[];
}

export interface ActivityLogRow {
  id: string;
  user_id: string | null;
  server_id: string | null;
  action: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  created_at: string;
}

export interface BackupRow {
  id: string;
  server_id: string;
  uuid: string | null;
  name: string | null;
  size_bytes: number | null;
  is_successful: boolean | null;
  checksum: string | null;
  created_at: string;
}

// ─── Auto Backup System (migration 005) ──────────────────────────────────────

export type StorageProviderType = 'gdrive' | 'dropbox' | 'onedrive' | 's3' | 'sftp' | 'webdav';

/** Config S3 (secret_key sudah terenkripsi saat dibaca dari DB). */
export interface S3StorageConfig {
  bucket: string;
  region: string;
  access_key: string;
  secret_key: string;
  endpoint?: string;
}

/** Config SFTP (password sudah terenkripsi saat dibaca dari DB). */
export interface SftpStorageConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  path: string;
}

/** Config WebDAV (password sudah terenkripsi saat dibaca dari DB). */
export interface WebdavStorageConfig {
  url: string;
  username: string;
  password: string;
}

export interface StorageProviderRow {
  id: string;
  user_id: string;
  provider: StorageProviderType;
  name: string;
  /** Terenkripsi AES-256-GCM — jangan pernah dikirim ke browser. */
  access_token: string | null;
  /** Terenkripsi AES-256-GCM — jangan pernah dikirim ke browser. */
  refresh_token: string | null;
  token_expires_at: string | null;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

/** Provider tanpa kredensial — aman dikirim ke browser. */
export interface PublicStorageProvider {
  id: string;
  provider: StorageProviderType;
  name: string;
  is_active: boolean;
  created_at: string;
  /** Ringkasan config tanpa secret (mis. bucket/region/endpoint S3, host SFTP). */
  config_public: Record<string, unknown>;
  /** Jumlah jadwal backup yang memakai provider ini. */
  schedules_count: number;
}

export type BackupInterval = 'hourly' | 'daily' | 'weekly';

export interface BackupScheduleRow {
  id: string;
  server_id: string;
  storage_provider_id: string;
  is_enabled: boolean;
  interval: BackupInterval;
  time_of_day: string | null;
  day_of_week: number | null;
  retention: number;
  ignore_files: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_by: string | null;
  created_at: string;
}

export type BackupLogStatus = 'pending' | 'creating' | 'uploading' | 'done' | 'failed';

export interface BackupLogRow {
  id: string;
  server_id: string;
  schedule_id: string | null;
  backup_uuid: string | null;
  storage_provider_id: string | null;
  storage_file_id: string | null;
  storage_file_name: string | null;
  size_bytes: number | null;
  status: BackupLogStatus | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

// ─── API payloads ────────────────────────────────────────────────────────────

export interface ApiErrorShape {
  error: string;
}

export interface SeedSummary {
  node: 'inserted' | 'skipped' | 'token-missing';
  servers_inserted: number;
  servers_skipped: number;
  allocations_inserted: number;
  details: Array<{ uuid: string; name: string; action: 'inserted' | 'skipped' }>;
}
