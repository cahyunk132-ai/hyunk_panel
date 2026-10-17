import 'server-only';

import { execVpsCommand } from '@/lib/vps/ssh';
import type { VpsRecord } from '@/lib/vps/access';

function shellDoubleQuote(value: string, label: string): string {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} tidak valid`);
  }
  // URLs are placed inside double quotes in the remote bash command. Escape
  // every character that retains shell meaning inside double quotes.
  return `"${value.replace(/[\\"$`!]/g, '\\$&')}"`;
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

/**
 * Download a Wings backup and upload it directly to a GDrive resumable
 * session from the owner's NAT VPS. The backup bytes never cross Vercel.
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
  const quotedWingsUrl = shellDoubleQuote(safeWingsUrl, 'Wings download URL');
  const quotedUploadUrl = shellDoubleQuote(safeUploadUrl, 'GDrive upload URL');

  const pipeline = [
    'set -o pipefail',
    `curl -fsSL --max-time 7200 ${quotedWingsUrl} | curl -fsSL --max-time 7200 -X PUT ${quotedUploadUrl}`,
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
  if (statusCode !== '200') {
    throw new Error(`GDrive resumable upload via VPS NAT mengembalikan HTTP ${statusCode || 'unknown'}`);
  }
}
