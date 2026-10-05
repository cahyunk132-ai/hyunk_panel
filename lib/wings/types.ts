// ─── Tipe response Wings v1 API ─────────────────────────────────────────────
// Diverifikasi terhadap github.com/pterodactyl/wings (branch develop).

/** GET /api/system — tanpa ?v=2 */
export interface WingsSystemInformationV1 {
  architecture: string;
  cpu_count: number;
  kernel_version: string;
  os: string;
  version: string;
}

/** GET /api/system?v=2 */
export interface WingsSystemInformationV2 {
  version: string;
  system: {
    architecture: string;
    cpu_threads: number;
    memory_bytes: number;
    kernel_version: string;
    os: string;
    os_type: string;
  };
  wings?: unknown;
}

export interface WingsResourceUsage {
  current_state: string;
  is_suspended: boolean;
  resources: {
    memory_bytes: number;
    cpu_absolute: number;
    network: { rx_bytes: number; tx_bytes: number };
    disk_bytes: number;
    uptime: number;
  };
}

/** Item dari GET /api/servers dan GET /api/servers/{uuid} (ToAPIResponse) */
export interface WingsServerAPIResponse {
  state: string;
  is_suspended: boolean;
  utilization: {
    memory_bytes: number;
    cpu_absolute: number;
    network: { rx_bytes: number; tx_bytes: number };
    uptime: number;
  };
  configuration: {
    uuid: string;
    meta?: { name?: string; description?: string | null };
    suspended: boolean;
    invocation?: string;
    container?: { image?: string };
    build?: {
      memory_limit?: number;
      swap?: number;
      io_weight?: number;
      cpu_limit?: number;
      threads?: string | null;
      disk_space?: number;
    };
  };
}

/** Item dari GET /api/servers/{uuid}/files/list-directory */
export interface WingsFileStat {
  name: string;
  created: string;
  modified: string;
  mode: string;
  mode_bits: string;
  size: number;
  directory: boolean;
  file: boolean;
  symlink: boolean;
  mime: string;
}

export interface WingsErrorBody {
  error?: string;
  request_id?: string;
}

// ─── WebSocket events (router/websocket/message.go) ─────────────────────────

export type WingsWsOutboundEvent =
  | 'auth'
  | 'send logs'
  | 'send stats'
  | 'send command'
  | 'set state';

export interface WingsWsMessage {
  event: string;
  args?: string[];
}

// ─── Stats yang di-push lewat event "stats" di WebSocket ────────────────────

export interface WingsStatsPayload {
  memory_bytes: number;
  memory_limit_bytes: number;
  cpu_absolute: number;
  network: { rx_bytes: number; tx_bytes: number };
  state: string;
  disk_bytes: number;
  uptime: number;
}
