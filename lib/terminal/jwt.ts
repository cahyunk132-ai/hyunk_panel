import 'server-only';
import crypto from 'node:crypto';

export const TERMINAL_TOKEN_TTL_SECONDS = 35 * 60;

export interface TerminalTokenClaims {
  host: string;
  port: number;
  username: string;
  password: string;
  userId: string;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function getSecret(): string {
  const secret = process.env.TERMINAL_JWT_SECRET;
  if (!secret) {
    throw new Error('TERMINAL_JWT_SECRET belum di-set');
  }
  return secret;
}

/**
 * JWT HS256 yang dibaca oleh terminal service eksternal.
 *
 * Credential tidak pernah dikirim ke browser sebagai field terpisah; hanya
 * token yang sudah ditandatangani ini yang dikirim lewat HTTPS ke panel lalu
 * dipakai untuk membuka WebSocket terminal.
 */
export function createTerminalToken(
  claims: TerminalTokenClaims,
  ttlSeconds = TERMINAL_TOKEN_TTL_SECONDS,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      ...claims,
      iat: now,
      exp: now + ttlSeconds,
    }),
  );
  const signature = crypto
    .createHmac('sha256', getSecret())
    .update(`${header}.${payload}`)
    .digest();

  return `${header}.${payload}.${base64Url(signature)}`;
}

/** Convert the configured HTTPS service URL to the browser WebSocket URL. */
export function getTerminalWebSocketUrl(): string {
  const configured = process.env.TERMINAL_SERVICE_URL;
  if (!configured) {
    throw new Error('TERMINAL_SERVICE_URL belum di-set');
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('TERMINAL_SERVICE_URL tidak valid');
  }

  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('TERMINAL_SERVICE_URL harus memakai http(s) atau ws(s)');
  }

  // The service URL is trusted server configuration, never client input.
  return url.toString().replace(/\/$/, '');
}
