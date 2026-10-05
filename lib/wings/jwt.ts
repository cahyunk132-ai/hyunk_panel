import crypto from 'node:crypto';

/**
 * Generator JWT yang kompatibel dengan Wings.
 *
 * Wings memverifikasi JWT dengan HS256 memakai token node sebagai secret
 * (lihat wings config.GetJwtAlgorithm → jwt.NewHS256(token)).
 * Payload wajib mengikuti struct di wings router/tokens/*.go:
 *
 *  - WebsocketPayload : user_uuid, server_uuid, permissions, scope "websocket"
 *  - FilePayload      : file_path, server_uuid, user_uuid, unique_id, scope "file-download"
 *  - UploadPayload    : server_uuid, user_uuid, unique_id, scope "file-upload"
 *  - BackupPayload    : server_uuid, user_uuid, backup_uuid, unique_id, scope "backup-download"
 *
 * Catatan: iat WAJIB diisi — wings menolak token tanpa iat (isDenylisted),
 * dan iat harus lebih baru dari waktu boot wings.
 */

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function signWingsJwt(secretToken: string, claims: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signature = crypto
    .createHmac('sha256', secretToken)
    .update(`${header}.${payload}`)
    .digest();
  return `${header}.${payload}.${base64url(signature)}`;
}

export interface WingsTokenContext {
  /** Token node yang sudah didekripsi (secret HMAC). */
  nodeSecret: string;
  serverUuid: string;
  userUuid: string;
}

/** JWT untuk console WebSocket — umur max 5 menit (aturan keamanan panel). */
export function createWebsocketToken(
  ctx: WingsTokenContext,
  permissions: string[],
  ttlSeconds = 300,
): string {
  const now = Math.floor(Date.now() / 1000);
  return signWingsJwt(ctx.nodeSecret, {
    iat: now,
    nbf: now - 5,
    exp: now + Math.min(ttlSeconds, 300),
    jti: crypto.randomUUID(),
    iss: 'hyunk-panel',
    user_uuid: ctx.userUuid,
    server_uuid: ctx.serverUuid,
    permissions,
    scope: 'websocket',
  });
}

/** JWT satu-kali-pakai untuk download file: GET {node}/download/file?token=... */
export function createFileDownloadToken(
  ctx: WingsTokenContext,
  filePath: string,
  ttlSeconds = 900,
): string {
  const now = Math.floor(Date.now() / 1000);
  return signWingsJwt(ctx.nodeSecret, {
    iat: now,
    nbf: now - 5,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
    file_path: filePath,
    server_uuid: ctx.serverUuid,
    user_uuid: ctx.userUuid,
    unique_id: crypto.randomUUID(),
    scope: 'file-download',
  });
}

/** JWT satu-kali-pakai untuk upload: POST {node}/upload/file?token=...&directory=... */
export function createUploadToken(ctx: WingsTokenContext, ttlSeconds = 900): string {
  const now = Math.floor(Date.now() / 1000);
  return signWingsJwt(ctx.nodeSecret, {
    iat: now,
    nbf: now - 5,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
    server_uuid: ctx.serverUuid,
    user_uuid: ctx.userUuid,
    unique_id: crypto.randomUUID(),
    scope: 'file-upload',
  });
}

/** JWT satu-kali-pakai untuk download backup: GET {node}/download/backup?token=... */
export function createBackupDownloadToken(
  ctx: WingsTokenContext,
  backupUuid: string,
  ttlSeconds = 900,
): string {
  const now = Math.floor(Date.now() / 1000);
  return signWingsJwt(ctx.nodeSecret, {
    iat: now,
    nbf: now - 5,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
    server_uuid: ctx.serverUuid,
    user_uuid: ctx.userUuid,
    backup_uuid: backupUuid,
    unique_id: crypto.randomUUID(),
    scope: 'backup-download',
  });
}
