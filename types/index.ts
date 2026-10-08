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
