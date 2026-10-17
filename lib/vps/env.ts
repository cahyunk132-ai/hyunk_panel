import 'server-only';

import { execVpsCommand, readVpsFile, writeVpsFile } from '@/lib/vps/ssh';
import { shellQuote, validateDeployPath } from '@/lib/vps/commands';
import type { VpsRecord } from '@/lib/vps/access';

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ENV_VARS = 200;
const MAX_ENV_VALUE_LENGTH = 16_384;

export function isSensitiveEnvKey(key: string): boolean {
  return /(password|secret|token|key)/i.test(key);
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separator = withoutExport.indexOf('=');
    if (separator <= 0) continue;
    const key = withoutExport.slice(0, separator).trim();
    if (!ENV_KEY_RE.test(key)) continue;
    result[key] = unquote(withoutExport.slice(separator + 1).trim());
  }
  return result;
}

export function validateEnvRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('env harus berupa object key-value');
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_ENV_VARS) throw new Error(`Maksimal ${MAX_ENV_VARS} environment variable`);
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!ENV_KEY_RE.test(key)) throw new Error(`Nama environment variable tidak valid: ${key}`);
    if (typeof value !== 'string' || value.length > MAX_ENV_VALUE_LENGTH || /[\u0000\r\n]/.test(value)) {
      throw new Error(`Nilai environment variable ${key} tidak valid`);
    }
    result[key] = value;
  }
  return result;
}

export function maskEnv(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, isSensitiveEnvKey(key) ? '***' : value]),
  );
}

export function serializeEnv(values: Record<string, string>): string {
  return `${Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

export function envFilePath(deployPath: unknown): string {
  return `${validateDeployPath(deployPath)}/.env`;
}

export async function readVpsEnv(vps: VpsRecord, deployPath: unknown): Promise<Record<string, string>> {
  const path = envFilePath(deployPath);
  const exists = await execVpsCommand(vps, `test -f ${shellQuote(path)}`);
  if (exists.code === 1) return {};
  if (exists.code !== 0) throw new Error('Gagal memeriksa file .env');
  const content = await readVpsFile(vps, path);
  return parseEnv(content.toString('utf8'));
}

export async function writeVpsEnv(
  vps: VpsRecord,
  deployPath: unknown,
  values: Record<string, string>,
): Promise<void> {
  await writeVpsFile(vps, envFilePath(deployPath), serializeEnv(values));
}
