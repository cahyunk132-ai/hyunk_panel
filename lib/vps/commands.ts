import 'server-only';

import { posix as posixPath } from 'node:path';
import type { VpsRecord } from '@/lib/vps/access';

const APP_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const USERNAME_SEGMENT_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** Quote one value for the remote POSIX shell. Never interpolate raw user input. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function validateAppName(value: unknown): string {
  if (typeof value !== 'string' || !APP_NAME_RE.test(value)) {
    throw new Error('Nama app hanya boleh berisi alphanumeric, dash, atau underscore (maks. 64 karakter)');
  }
  return value;
}

export function validateScriptPath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Path script wajib berupa teks');
  const script = value.trim();
  if (!script || script.startsWith('-') || script.length > 512 || /[\u0000-\u001f\u007f]/.test(script)) {
    throw new Error('Path script tidak valid');
  }
  if (script.split('/').includes('..') || script.split('\\').includes('..')) {
    throw new Error('Path script tidak boleh mengandung traversal');
  }
  if (script.startsWith('/') && !script.startsWith('/home/') && !script.startsWith('/root/')) {
    throw new Error('Path script absolut harus berada di bawah /home/ atau /root/');
  }
  return script;
}

export function validateInterpreter(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Interpreter tidak valid');
  const interpreter = value.trim();
  if (!interpreter || interpreter.startsWith('-') || interpreter.length > 128 || !/^[A-Za-z0-9_./-]+$/.test(interpreter)) {
    throw new Error('Interpreter tidak valid');
  }
  return interpreter;
}

/** Only app data roots are accepted for deploy/cwd/env operations. */
export function validateDeployPath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Deploy path wajib berupa teks');
  const raw = value.trim();
  if (!raw || raw.includes('\0') || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error('Deploy path tidak valid');
  }
  if (raw.split('/').some((segment) => segment === '..')) {
    throw new Error('Deploy path tidak boleh mengandung traversal');
  }
  const normalized = posixPath.normalize(raw);
  if (!normalized.startsWith('/home/') && !normalized.startsWith('/root/')) {
    throw new Error('Deploy path harus berada di bawah /home/ atau /root/');
  }
  if (normalized === '/home' || normalized === '/root') {
    throw new Error('Deploy path harus menunjuk ke folder aplikasi');
  }
  return normalized;
}

export function getVpsHomeDirectory(vps: VpsRecord): string {
  const username = vps.username.trim();
  if (!USERNAME_SEGMENT_RE.test(username)) {
    throw new Error('Username VPS tidak dapat dipakai untuk membuat path default');
  }
  return username === 'root' ? '/root' : `/home/${username}`;
}

export function getDefaultDeployPath(vps: VpsRecord, appName: string): string {
  validateAppName(appName);
  return `${getVpsHomeDirectory(vps)}/apps/${appName}`;
}

export function validateLineCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 100);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error('Jumlah baris harus berupa angka 1 sampai 1000');
  }
  return parsed;
}

export function isSafeArchiveEntry(entry: string): boolean {
  const normalized = entry.replaceAll('\\', '/');
  return Boolean(
    normalized &&
      !normalized.startsWith('/') &&
      !normalized.split('/').some((segment) => segment === '..') &&
      !/[\u0000-\u001f\u007f]/.test(normalized),
  );
}

export function commandOutput(result: { stdout: string; stderr: string; code: number | null }): string {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n').trim();
}

export function assertCommandSucceeded(
  result: { stdout: string; stderr: string; code: number | null },
  fallback: string,
): string {
  if (result.code !== 0) {
    throw new Error(commandOutput(result) || fallback);
  }
  return commandOutput(result);
}
