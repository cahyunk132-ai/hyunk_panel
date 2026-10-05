// ─── Tipe domain Hyunk Panel (mirror skema Supabase) ────────────────────────

export type UserRole = 'admin' | 'user';

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
  status: ServerStatus;
  is_suspended: boolean;
  created_at: string;
}

export interface ServerUserRow {
  server_id: string;
  user_id: string;
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
