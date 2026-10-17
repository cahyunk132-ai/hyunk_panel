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
  const lastByte = Math.max(fileSizeBytes - 1, 0);

  const pythonScriptContent = [
    '#!/usr/bin/env python3',
    'import sys',
    'import json',
    'import time',
    'import ssl',
    'import urllib.request',
    'import urllib.error',
    'from datetime import datetime',
    '',
    'wings_url = sys.argv[1]',
    'upload_url = sys.argv[2]',
    'total_size = int(sys.argv[3])',
    'callback_url = sys.argv[4]',
    'token = sys.argv[5]',
    '',
    '# 32 MB per chunk (33,554,432 bytes = 128 * 256 KiB, kelipatan wajib 256 KiB)',
    'CHUNK_SIZE = 32 * 1024 * 1024',
    '',
    'def log(msg):',
    "    ts = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')",
    '    print(f"[{ts}] {msg}", flush=True)',
    '',
    'def send_callback(http_code, exit_code, error=""):',
    '    try:',
    '        data = json.dumps({',
    '            "token": token,',
    '            "http_code": str(http_code),',
    '            "exit_code": exit_code,',
    '            "error": error[:300]',
    "        }).encode('utf-8')",
    '        req = urllib.request.Request(',
    '            callback_url,',
    '            data=data,',
    '            headers={"Content-Type": "application/json"},',
    '            method="POST"',
    '        )',
    '        ctx = ssl.create_default_context()',
    '        ctx.check_hostname = False',
    '        ctx.verify_mode = ssl.CERT_NONE',
    '        urllib.request.urlopen(req, timeout=45, context=ctx)',
    '        log(f"Callback berhasil dikirim: HTTP {http_code}, exit {exit_code}")',
    '    except Exception as e:',
    '        log(f"Gagal mengirim callback: {e}")',
    '',
    'try:',
    '    log(f"Memulai transfer relay chunked: {total_size} bytes ({total_size / (1024*1024*1024):.2f} GB)")',
    '    ssl_ctx = ssl.create_default_context()',
    '    ssl_ctx.check_hostname = False',
    '    ssl_ctx.verify_mode = ssl.CERT_NONE',
    '',
    '    wings_req = urllib.request.Request(',
    '        wings_url,',
    '        headers={"User-Agent": "HyunkPanel-Relay/1.0"}',
    '    )',
    '    wings_resp = urllib.request.urlopen(wings_req, timeout=300, context=ssl_ctx)',
    '',
    '    start_byte = 0',
    '    chunk_index = 0',
    '    total_chunks = (total_size + CHUNK_SIZE - 1) // CHUNK_SIZE',
    '',
    '    while start_byte < total_size:',
    '        to_read = min(CHUNK_SIZE, total_size - start_byte)',
    '        buf = bytearray()',
    '        while len(buf) < to_read:',
    '            needed = to_read - len(buf)',
    '            read_size = min(needed, 1024 * 1024)',
    '            part = wings_resp.read(read_size)',
    '            if not part:',
    '                break',
    '            buf.extend(part)',
    '',
    '        chunk_len = len(buf)',
    '        if chunk_len == 0:',
    '            raise Exception(f"EOF lebih awal dari Wings di byte {start_byte} (diharapkan {total_size})")',
    '',
    '        end_byte = start_byte + chunk_len - 1',
    '        content_range = f"bytes {start_byte}-{end_byte}/{total_size}"',
    '        chunk_index += 1',
    '        percent = (end_byte + 1) / total_size * 100',
    '        log(f"Mengunggah chunk {chunk_index}/{total_chunks} ({content_range}, {chunk_len} bytes, {percent:.1f}%)...")',
    '',
    '        upload_req = urllib.request.Request(',
    '            upload_url,',
    '            data=bytes(buf),',
    '            headers={',
    '                "Content-Type": "application/octet-stream",',
    '                "Content-Length": str(chunk_len),',
    '                "Content-Range": content_range',
    '            },',
    '            method="PUT"',
    '        )',
    '',
    '        chunk_ok = False',
    '        last_chunk_err = None',
    '        for attempt in range(1, 4):',
    '            try:',
    '                with urllib.request.urlopen(upload_req, timeout=180, context=ssl_ctx) as gdrive_resp:',
    '                    status_code = gdrive_resp.status',
    '                    if status_code in (200, 201):',
    '                        log(f"Chunk terakhir berhasil diterima: HTTP {status_code}")',
    '                        chunk_ok = True',
    '                        break',
    '            except urllib.error.HTTPError as he:',
    '                if he.code == 308:',
    '                    # 308 Resume Incomplete = chunk berhasil diterima oleh Google Drive',
    '                    chunk_ok = True',
    '                    break',
    '                else:',
    '                    last_chunk_err = f"HTTP {he.code}: {he.reason}"',
    '                    log(f"Percobaan {attempt}/3 gagal ({last_chunk_err}), mencoba lagi dalam 5s...")',
    '                    time.sleep(5)',
    '            except Exception as e:',
    '                last_chunk_err = str(e)',
    '                log(f"Percobaan {attempt}/3 error ({last_chunk_err}), mencoba lagi dalam 5s...")',
    '                time.sleep(5)',
    '',
    '        if not chunk_ok:',
    '            raise Exception(f"Gagal mengunggah chunk {chunk_index} setelah 3 percobaan: {last_chunk_err}")',
    '',
    '        start_byte += chunk_len',
    '        buf = None',
    '',
    '    log(f"Seluruh {total_chunks} chunk ({total_size} bytes) berhasil diunggah ke Google Drive!")',
    '    send_callback("200", 0)',
    '',
    'except Exception as err:',
    '    err_str = str(err)',
    '    log(f"Transfer relay gagal: {err_str}")',
    '    send_callback("500", 1, err_str)',
    '    sys.exit(1)',
  ].join('\n').replace(/\r\n/g, '\n');

  const launcherScriptContent = [
    '#!/usr/bin/env bash',
    'set -o pipefail',
    `LOG_FILE="/tmp/hyunk_relay_${safeLogId}.log"`,
    'exec >> "$LOG_FILE" 2>&1',
    '',
    `echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] Memulai transfer relay backup (${fileSizeBytes} bytes)"`,
    '',
    '# Periksa ketersediaan interpreter Python di VPS',
    'PYTHON_BIN=""',
    'if command -v python3 >/dev/null 2>&1; then',
    '  PYTHON_BIN="python3"',
    'elif command -v python >/dev/null 2>&1; then',
    '  PYTHON_BIN="python"',
    'fi',
    '',
    'if [ -n "$PYTHON_BIN" ]; then',
    '  echo "[$(date -u +\'%Y-%m-%dT%H:%M:%SZ\')] Menjalankan chunked uploader via $PYTHON_BIN (32 MB chunks)"',
    `  "$PYTHON_BIN" "/tmp/hyunk_relay_${safeLogId}.py" \\`,
    `    ${shellSingleQuote(safeWingsUrl)} \\`,
    `    ${shellSingleQuote(safeUploadUrl)} \\`,
    `    "${fileSizeBytes}" \\`,
    `    ${shellSingleQuote(safeCallbackUrl)} \\`,
    `    "${offloadToken}"`,
    'else',
    '  echo "[$(date -u +\'%Y-%m-%dT%H:%M:%SZ\')] Python tidak ditemukan, fallback ke curl streaming"',
    `  HTTP_CODE=$(curl -fsSL --retry 2 --retry-delay 5 --max-time 14400 ${shellSingleQuote(safeWingsUrl)} 2>>"$LOG_FILE" | curl -sS --max-time 14400 -T - ${shellSingleQuote(safeUploadUrl)} -H "Content-Type: application/octet-stream" -H "Content-Length: ${fileSizeBytes}" -H "Content-Range: bytes 0-${lastByte}/${fileSizeBytes}" -H "Transfer-Encoding:" -H "Expect:" -o /dev/null -w "%{http_code}" 2>>"$LOG_FILE")`,
    '  PIPE_EXIT=$?',
    '',
    '  echo "[$(date -u +\'%Y-%m-%dT%H:%M:%SZ\')] Stream selesai: HTTP_CODE=$HTTP_CODE, EXIT_CODE=$PIPE_EXIT"',
    '',
    '  ERR_SNIPPET=""',
    '  if [ "$PIPE_EXIT" -ne 0 ] || [ "$HTTP_CODE" != "200" -a "$HTTP_CODE" != "201" ]; then',
    '    ERR_SNIPPET=$(tail -n 10 "$LOG_FILE" 2>/dev/null | tr \'\\n\' \' \' | tr \'"\' "\'" | cut -c 1-250)',
    '  fi',
    '',
    '  # Lapor status ke panel callback',
    `  curl -fsSL -X POST ${shellSingleQuote(safeCallbackUrl)} \\`,
    '    -H "Content-Type: application/json" \\',
    `    -d "{\\"token\\":\\"${offloadToken}\\",\\"http_code\\":\\"$HTTP_CODE\\",\\"exit_code\\":$PIPE_EXIT,\\"error\\":\\"$ERR_SNIPPET\\"}" \\`,
    '    --retry 3 --retry-delay 5 --max-time 60',
    'fi',
    '',
    '# Hapus file script sementara',
    `rm -f "/tmp/hyunk_relay_${safeLogId}.py" "/tmp/hyunk_relay_${safeLogId}.sh"`,
  ].join('\n').replace(/\r\n/g, '\n');

  const remotePyPath = `/tmp/hyunk_relay_${safeLogId}.py`;
  const remoteShPath = `/tmp/hyunk_relay_${safeLogId}.sh`;

  // Tulis script ke VPS via SFTP
  await writeVpsFile(vps, remotePyPath, pythonScriptContent);
  await writeVpsFile(vps, remoteShPath, launcherScriptContent);

  // Jalankan detached di background dengan nohup
  const launchCommand = `nohup bash ${remoteShPath} </dev/null >/dev/null 2>&1 &`;
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
  const lastByte = Math.max(fileSizeBytes - 1, 0);

  const pipeline = [
    'set -o pipefail',
    `curl -fsSL --max-time 7200 ${shellSingleQuote(safeWingsUrl)} | curl -fsSL --max-time 7200 -T - ${shellSingleQuote(safeUploadUrl)}`,
    `-H "Content-Type: application/octet-stream" -H "Content-Length: ${fileSizeBytes}" -H "Content-Range: bytes 0-${lastByte}/${fileSizeBytes}" -H "Transfer-Encoding:" -H "Expect:"`,
    '-o /dev/null -w "%{http_code}"',
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
