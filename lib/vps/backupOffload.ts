import 'server-only';

import { execVpsCommand, writeVpsFile } from '@/lib/vps/ssh';
import type { VpsRecord } from '@/lib/vps/access';
import { signWingsJwt, verifyWingsJwt } from '@/lib/wings/jwt';

export interface BackupOffloadPayload {
  log_id: string;
  server_id: string;
  server_uuid: string;
  backup_uuid: string;
  schedule_id: string | null;
  provider_id: string;
  file_name: string;
  folder_id: string;
  size_bytes: number;
  owner_id: string | null;
  user_id: string | null;
  trigger: string;
  exp: number;
  iat: number;
  action: 'backup_offload_callback';
}

function getOffloadSigningSecret(): string {
  const secret =
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.WINGS_TOKEN_ENCRYPTION_KEY ||
    'hyunk-backup-offload-internal-secret-key';
  return secret;
}

export function signBackupOffloadToken(
  payload: Omit<BackupOffloadPayload, 'exp' | 'iat' | 'action'>,
  ttlSeconds = 14400,
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullClaims = {
    ...payload,
    exp: now + ttlSeconds,
    iat: now,
    action: 'backup_offload_callback' as const,
  };
  return signWingsJwt(getOffloadSigningSecret(), fullClaims);
}

export function verifyBackupOffloadToken(token: string): BackupOffloadPayload | null {
  const claims = verifyWingsJwt(token, getOffloadSigningSecret());
  if (!claims || claims.action !== 'backup_offload_callback') {
    return null;
  }
  return claims as unknown as BackupOffloadPayload;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function validateHttpsUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} tidak valid`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${label} harus berupa URL HTTPS tanpa credential inline`);
  }
  return value;
}

function diagnostic(stderr: string, secrets: string[]): string {
  const safe = secrets.reduce((message, secret) => message.replaceAll(secret, '[redacted]'), stderr.trim());
  return safe.slice(0, 500);
}

export interface BackgroundBackupOffloadOptions {
  vps: VpsRecord;
  wingsDownloadUrl: string;
  gdriveUploadUrl: string;
  fileSizeBytes: number;
  callbackUrl: string;
  offloadToken: string;
  logId: string;
}

/**
 * Dispatch an asynchronous detached backup transfer to the relay VPS.
 * The VPS streams directly from Wings to GDrive in the background, then
 * calls the panel webhook to mark the job done and trigger cleanup.
 * This exits in under 1 second without holding the serverless function open.
 */
export async function startBackgroundBackupOffloadViaVps(
  options: BackgroundBackupOffloadOptions,
): Promise<void> {
  const { vps, wingsDownloadUrl, gdriveUploadUrl, fileSizeBytes, callbackUrl, offloadToken, logId } = options;

  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes < 0) {
    throw new Error('Ukuran backup untuk VPS Relay tidak valid');
  }

  const safeWingsUrl = validateHttpsUrl(wingsDownloadUrl, 'Wings download URL');
  const safeUploadUrl = validateHttpsUrl(gdriveUploadUrl, 'GDrive upload URL');
  const safeCallbackUrl = validateHttpsUrl(callbackUrl, 'Callback URL');
  const safeLogId = logId.replace(/[^a-zA-Z0-9_-]/g, '');

  const scriptContent = [
    '#!/usr/bin/env bash',
    'set -o pipefail',
    `LOG_FILE="/tmp/hyunk_relay_${safeLogId}.log"`,
    'exec >> "$LOG_FILE" 2>&1',
    '',
    `echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Memulai transfer relay backup (${fileSizeBytes} bytes)"`,
    '',
    '# 1. Stream dari Wings langsung ke GDrive Resumable Upload session',
    `HTTP_CODE=$(curl -fsSL --retry 2 --retry-delay 5 --max-time 14400 ${shellSingleQuote(safeWingsUrl)} 2>>"$LOG_FILE" | curl -sS --max-time 14400 -X PUT ${shellSingleQuote(safeUploadUrl)} -H "Content-Type: application/octet-stream" -H "Content-Length: ${fileSizeBytes}" --data-binary @- -o /dev/null -w "%{http_code}" 2>>"$LOG_FILE")`,
    'PIPE_EXIT=$?',
    '',
    `echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Stream selesai: HTTP_CODE=$HTTP_CODE, EXIT_CODE=$PIPE_EXIT"`,
    '',
    '# 2. Lapor status ke panel callback',
    `curl -fsSL -X POST ${shellSingleQuote(safeCallbackUrl)} \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d "{\\"token\\":\\"${offloadToken}\\",\\"http_code\\":\\"$HTTP_CODE\\",\\"exit_code\\":$PIPE_EXIT}" \\`,
    '  --retry 3 --retry-delay 5 --max-time 60',
    'CALLBACK_EXIT=$?',
    `echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Callback selesai dengan EXIT_CODE=$CALLBACK_EXIT"`,
    '',
    '# 3. Hapus file script sementara',
    `rm -f "/tmp/hyunk_relay_${safeLogId}.sh"`,
  ].join('\n').replace(/\r\n/g, '\n');

  const remoteScriptPath = `/tmp/hyunk_relay_${safeLogId}.sh`;

  // Tulis script ke VPS via SFTP
  await writeVpsFile(vps, remoteScriptPath, scriptContent);

  // Jalankan detached di background dengan nohup
  const launchCommand = `nohup bash ${remoteScriptPath} </dev/null >/dev/null 2>&1 &`;
  const launchResult = await execVpsCommand(vps, launchCommand);

  if (launchResult.code !== 0) {
    const detail = diagnostic(launchResult.stderr, [safeWingsUrl, safeUploadUrl, offloadToken]);
    throw new Error(`Gagal meluncurkan transfer backup di VPS Relay${detail ? `: ${detail}` : ''}`);
  }
}

/**
 * Synchronous legacy fallback:
 * Download a Wings backup and upload it directly to a GDrive resumable
 * session from the owner's NAT VPS.
 */
export async function offloadBackupViaVpsNat(
  vps: VpsRecord,
  wingsDownloadUrl: string,
  gdriveUploadUrl: string,
  fileSizeBytes: number,
): Promise<void> {
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes < 0) {
    throw new Error('Ukuran backup untuk VPS NAT tidak valid');
  }

  const safeWingsUrl = validateHttpsUrl(wingsDownloadUrl, 'Wings download URL');
  const safeUploadUrl = validateHttpsUrl(gdriveUploadUrl, 'GDrive upload URL');

  const pipeline = [
    'set -o pipefail',
    `curl -fsSL --max-time 7200 ${shellSingleQuote(safeWingsUrl)} | curl -fsSL --max-time 7200 -X PUT ${shellSingleQuote(safeUploadUrl)}`,
    `-H "Content-Type: application/octet-stream" -H "Content-Length: ${fileSizeBytes}"`,
    '--data-binary @- -o /dev/null -w "%{http_code}"',
  ].join(' ');
  const command = `bash -o pipefail -c ${shellSingleQuote(pipeline)}`;
  const result = await execVpsCommand(vps, command);

  if (result.code !== 0) {
    const detail = diagnostic(result.stderr, [safeWingsUrl, safeUploadUrl]);
    throw new Error(`Transfer backup via VPS NAT gagal${detail ? `: ${detail}` : ''}`);
  }

  const statusCode = result.stdout.trim();
  if (statusCode !== '200' && statusCode !== '201') {
    throw new Error(`GDrive resumable upload via VPS NAT mengembalikan HTTP ${statusCode || 'unknown'}`);
  }
}
