import 'server-only';
import type { AllocationRow, ServerRow } from '@/types';

/**
 * Membangun response konfigurasi server untuk Wings Remote API, dengan shape
 * yang persis dikonsumsi wings (remote/types.go → ServerConfigurationResponse):
 *
 *   { settings: {...}, process_configuration: {...} }
 *
 * Settings mengikuti struktur JSON server milik Pterodactyl panel, karena
 * wings mem-parse field tersebut saat InitServer / UpdateConfiguration.
 */

export interface RemoteProcessConfiguration {
  startup: {
    done: string[];
    user_interaction: string[];
    strip_ansi: boolean;
  };
  stop: { type: 'command' | 'signal'; value: string };
  configs: unknown[];
}

export interface RemoteServerSettings {
  uuid: string;
  meta: { name: string; description: string | null };
  suspended: boolean;
  invocation: string;
  skip_egg_scripts: boolean;
  environment: Record<string, string>;
  allocations: {
    force_outgoing_ip: boolean;
    default: { ip: string; port: number } | null;
    mappings: Record<string, number[]>;
  };
  build: {
    memory_limit: number;
    swap: number;
    io_weight: number;
    cpu_limit: number;
    threads: string | null;
    disk_space: number;
    oom_disabled: boolean;
  };
  mounts: unknown[];
  egg: { id: string };
  container: { image: string; oom_disabled: boolean; requires_rebuild: boolean };
  rebuild: { skip_files: boolean };
}

interface ServerProfile {
  done: string[];
  stop: { type: 'command' | 'signal'; value: string };
  stripAnsi: boolean;
}

/** Profil stop/done detection berdasar image & startup command. */
export function detectServerProfile(server: Pick<ServerRow, 'image' | 'startup' | 'env'>): ServerProfile {
  const image = server.image.toLowerCase();
  const startup = server.startup.toLowerCase();

  if (startup.includes('bedrock_server') || image.includes('bedrock')) {
    return {
      done: ['Server started'],
      stop: { type: 'command', value: 'stop' },
      stripAnsi: true,
    };
  }
  if (image.includes('nodejs') || /\.(js|ts|mjs|cjs)\b/.test(startup)) {
    // NodeJS tidak punya penanda "done" baku — gunakan signal untuk stop.
    return {
      done: [''],
      stop: { type: 'signal', value: 'SIGINT' },
      stripAnsi: false,
    };
  }
  if (image.includes('java') || startup.includes('-jar')) {
    return {
      // Cocok untuk Paper/Spigot/Vanilla ("Done (x.xxs)! For help, type "help"")
      done: ['For help, type "help"'],
      stop: { type: 'command', value: 'stop' },
      stripAnsi: false,
    };
  }
  return {
    done: [''],
    stop: { type: 'signal', value: 'SIGTERM' },
    stripAnsi: true,
  };
}

/** Environment lengkap yang disodorkan ke wings (env server + variabel bawaan egg). */
export function buildEnvironment(
  server: ServerRow,
  allocation: Pick<AllocationRow, 'ip' | 'port'> | null,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(server.env ?? {})) {
    env[k] = String(v ?? '');
  }
  // Variabel bawaan yang direferensikan banyak startup command egg.
  env.SERVER_MEMORY = String(server.memory_mb);
  env.SERVER_IP = allocation?.ip ?? '0.0.0.0';
  env.SERVER_PORT = String(allocation?.port ?? 0);
  return env;
}

export function buildProcessConfiguration(server: ServerRow): RemoteProcessConfiguration {
  const profile = detectServerProfile(server);
  return {
    startup: {
      done: profile.done,
      user_interaction: [],
      strip_ansi: profile.stripAnsi,
    },
    stop: profile.stop,
    configs: [],
  };
}

export function buildServerSettings(
  server: ServerRow,
  allocation: Pick<AllocationRow, 'ip' | 'port'> | null,
  nodeUuid: string,
): RemoteServerSettings {
  const ip = allocation?.ip ?? '0.0.0.0';
  const port = allocation?.port ?? 0;
  return {
    uuid: server.uuid,
    meta: { name: server.name, description: null },
    suspended: server.is_suspended,
    invocation: server.startup,
    skip_egg_scripts: true,
    environment: buildEnvironment(server, allocation),
    allocations: {
      force_outgoing_ip: false,
      default: { ip, port },
      mappings: { [ip]: [port] },
    },
    build: {
      memory_limit: server.memory_mb,
      swap: 0,
      io_weight: 500,
      cpu_limit: server.cpu_limit,
      threads: null,
      // disk_mb null (server existing tanpa limit) → 0 = unlimited di wings.
      disk_space: server.disk_mb ?? 0,
      // OOM killer dimatikan di level container agar JVM tidak dibunuh kernel.
      oom_disabled: true,
    },
    mounts: [],
    egg: { id: nodeUuid },
    container: { image: server.image, oom_disabled: true, requires_rebuild: false },
    rebuild: { skip_files: false },
  };
}

/**
 * Script instalasi yang diminta wings saat install/reinstall
 * (GET /api/remote/servers/{uuid}/install).
 *
 * Kita tidak memiliki egg install scripts — default-nya no-op yang sukses,
 * sehingga alur install tetap selesai untuk image yang sudah berisi file.
 * Kustomisasi bisa ditambahkan nanti per-image.
 */
export function buildInstallationScript(server: ServerRow): {
  container_image: string;
  entrypoint: string;
  script: string;
} {
  return {
    container_image: 'ghcr.io/pterodactyl/installers:alpine',
    entrypoint: 'ash',
    script: [
      '#!/bin/ash',
      '# Hyunk Panel — no-op install script',
      `# Server: ${server.name} (${server.uuid})`,
      '# File sudah ada di volume; instalasi diselesaikan tanpa perubahan data.',
      'echo "[hyunk-panel] instalasi selesai (no-op), data volume tidak disentuh."',
      'exit 0',
    ].join('\n'),
  };
}
