import { isDownloadProvider } from './download-providers';
import type { DownloadProvider } from '@/types';

export type JsonObject = Record<string, unknown>;

export interface EggFields {
  name?: string;
  description?: string | null;
  docker_image?: string;
  startup?: string;
  config_stop?: string;
  config_startup?: JsonObject;
  env_variables?: unknown[];
  features?: string[];
}

export interface VersionFields {
  name?: string;
  minecraft_version?: string | null;
  docker_image?: string | null;
  env_overrides?: Record<string, string>;
  is_recommended?: boolean;
  sort_order?: number;
  download_provider?: DownloadProvider;
  download_url_template?: string | null;
  download_variables?: Record<string, string>;
  download_filename?: string | null;
  download_executable?: boolean;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function parseEggFields(
  value: unknown,
  partial = false,
): { fields?: EggFields; error?: string } {
  if (!isJsonObject(value)) return { error: 'Body harus berupa object JSON.' };
  const fields: EggFields = {};

  if (!partial || value.name !== undefined) {
    if (typeof value.name !== 'string' || !value.name.trim()) {
      return { error: 'Nama egg wajib diisi.' };
    }
    fields.name = value.name.trim();
  }
  if (!partial || value.docker_image !== undefined) {
    if (typeof value.docker_image !== 'string' || !value.docker_image.trim()) {
      return { error: 'Docker image wajib diisi.' };
    }
    fields.docker_image = value.docker_image.trim();
  }
  if (!partial || value.startup !== undefined) {
    if (typeof value.startup !== 'string' || !value.startup.trim()) {
      return { error: 'Startup command wajib diisi.' };
    }
    fields.startup = value.startup.trim();
  }
  if (value.description !== undefined) {
    if (value.description !== null && typeof value.description !== 'string') {
      return { error: 'Description harus berupa teks atau null.' };
    }
    fields.description = typeof value.description === 'string' ? value.description.trim() || null : null;
  } else if (!partial) {
    fields.description = null;
  }
  if (value.config_stop !== undefined) {
    if (typeof value.config_stop !== 'string') return { error: 'config_stop harus berupa teks.' };
    fields.config_stop = value.config_stop;
  } else if (!partial) {
    fields.config_stop = 'stop';
  }
  if (value.config_startup !== undefined) {
    if (!isJsonObject(value.config_startup)) {
      return { error: 'config_startup harus berupa object JSON.' };
    }
    fields.config_startup = value.config_startup;
  } else if (!partial) {
    fields.config_startup = {};
  }
  if (value.env_variables !== undefined) {
    if (!Array.isArray(value.env_variables)) {
      return { error: 'env_variables harus berupa array JSON.' };
    }
    fields.env_variables = value.env_variables;
  } else if (!partial) {
    fields.env_variables = [];
  }
  if (value.features !== undefined) {
    if (!isStringArray(value.features)) return { error: 'features harus berupa array teks.' };
    fields.features = value.features.map((feature) => feature.trim()).filter(Boolean);
  } else if (!partial) {
    fields.features = [];
  }

  return { fields };
}

export function parseVersionFields(
  value: unknown,
  partial = false,
): { fields?: VersionFields; error?: string } {
  if (!isJsonObject(value)) return { error: 'Body harus berupa object JSON.' };
  const fields: VersionFields = {};

  if (!partial || value.name !== undefined) {
    if (typeof value.name !== 'string' || !value.name.trim()) {
      return { error: 'Nama versi wajib diisi.' };
    }
    fields.name = value.name.trim();
  }
  if (value.minecraft_version !== undefined) {
    if (value.minecraft_version !== null && typeof value.minecraft_version !== 'string') {
      return { error: 'minecraft_version harus berupa teks atau null.' };
    }
    fields.minecraft_version =
      typeof value.minecraft_version === 'string' ? value.minecraft_version.trim() || null : null;
  } else if (!partial) {
    fields.minecraft_version = null;
  }
  if (value.docker_image !== undefined) {
    if (value.docker_image !== null && typeof value.docker_image !== 'string') {
      return { error: 'docker_image harus berupa teks atau null.' };
    }
    fields.docker_image =
      typeof value.docker_image === 'string' ? value.docker_image.trim() || null : null;
  } else if (!partial) {
    fields.docker_image = null;
  }
  if (value.env_overrides !== undefined) {
    if (!isJsonObject(value.env_overrides)) {
      return { error: 'env_overrides harus berupa object JSON.' };
    }
    const overrides: Record<string, string> = {};
    for (const [key, item] of Object.entries(value.env_overrides)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return { error: `Key environment variable "${key}" tidak valid.` };
      }
      if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
        return { error: `Nilai env_overrides untuk "${key}" harus berupa teks atau angka.` };
      }
      overrides[key] = String(item);
    }
    fields.env_overrides = overrides;
  } else if (!partial) {
    fields.env_overrides = {};
  }
  if (value.is_recommended !== undefined) {
    if (typeof value.is_recommended !== 'boolean') {
      return { error: 'is_recommended harus berupa boolean.' };
    }
    fields.is_recommended = value.is_recommended;
  } else if (!partial) {
    fields.is_recommended = false;
  }
  if (value.sort_order !== undefined) {
    if (typeof value.sort_order !== 'number' || !Number.isInteger(value.sort_order)) {
      return { error: 'sort_order harus berupa bilangan bulat.' };
    }
    fields.sort_order = value.sort_order;
  } else if (!partial) {
    fields.sort_order = 0;
  }

  // ── Generic Auto Download System (migration 004) ──────────────────────────
  const requestedProvider = value.download_provider;
  if (requestedProvider !== undefined) {
    if (!isDownloadProvider(requestedProvider)) {
      return { error: 'download_provider tidak dikenal.' };
    }
    fields.download_provider = requestedProvider;
  } else if (!partial) {
    fields.download_provider = 'none';
  }

  if (value.download_url_template !== undefined) {
    if (value.download_url_template !== null && typeof value.download_url_template !== 'string') {
      return { error: 'download_url_template harus berupa teks atau null.' };
    }
    fields.download_url_template =
      typeof value.download_url_template === 'string'
        ? value.download_url_template.trim() || null
        : null;
  } else if (!partial) {
    fields.download_url_template = null;
  }

  if (value.download_variables !== undefined) {
    if (!isJsonObject(value.download_variables)) {
      return { error: 'download_variables harus berupa object JSON key-value.' };
    }
    const variables: Record<string, string> = {};
    for (const [key, item] of Object.entries(value.download_variables)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        return { error: `Key download_variables "${key}" tidak valid.` };
      }
      if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
        return { error: `Nilai download_variables untuk "${key}" harus berupa teks atau angka.` };
      }
      variables[key] = String(item);
    }
    fields.download_variables = variables;
  } else if (!partial) {
    fields.download_variables = {};
  }

  if (value.download_filename !== undefined) {
    if (value.download_filename !== null && typeof value.download_filename !== 'string') {
      return { error: 'download_filename harus berupa teks atau null.' };
    }
    const filename =
      typeof value.download_filename === 'string' ? value.download_filename.trim() : '';
    if (filename && (filename === '.' || filename === '..' || filename.length > 255 || /[\\/\0]/.test(filename))) {
      return { error: 'download_filename tidak valid — gunakan nama file saja tanpa folder.' };
    }
    fields.download_filename = filename || null;
  } else if (!partial) {
    fields.download_filename = 'server.jar';
  }

  if (value.download_executable !== undefined) {
    if (typeof value.download_executable !== 'boolean') {
      return { error: 'download_executable harus berupa boolean.' };
    }
    fields.download_executable = value.download_executable;
  } else if (!partial) {
    fields.download_executable = false;
  }

  // Provider custom tidak berguna tanpa template; tolak sejak validasi bila
  // provider diset eksplisit ke 'custom' di request ini tanpa template.
  const effectiveProvider = fields.download_provider;
  if (
    effectiveProvider === 'custom' &&
    fields.download_url_template === null &&
    !(partial && value.download_url_template === undefined)
  ) {
    return { error: 'Provider custom membutuhkan download_url_template (mis. https://contoh.com/download/{VERSION}/{FILE}).' };
  }

  return { fields };
}

export function parseNodeIds(value: unknown): { ids?: string[]; error?: string } {
  if (!Array.isArray(value) || !value.every((id) => typeof id === 'string' && id.trim())) {
    return { error: 'node_ids harus berupa array ID node.' };
  }
  return { ids: Array.from(new Set(value.map((id: string) => id.trim()))) };
}

export function getEggEnvDefaults(variables: unknown): Record<string, string> {
  if (!Array.isArray(variables)) return {};
  const env: Record<string, string> = {};
  for (const item of variables) {
    if (!isJsonObject(item)) continue;
    const key = item.env_variable;
    if (typeof key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = item.default_value;
    env[key] = value === null || value === undefined ? '' : String(value);
  }
  return env;
}

export function normalizeEnvOverrides(value: unknown): Record<string, string> {
  if (!isJsonObject(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      result[key] = String(item);
    }
  }
  return result;
}
