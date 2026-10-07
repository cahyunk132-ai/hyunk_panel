/**
 * Server List Ping (SLP) Java Edition — dipakai API route player action untuk
 * memeriksa apakah player sedang online TANPA plugin: status ping vanilla
 * mengembalikan daftar nama player yang sedang terhubung (`players.sample`).
 *
 * Server-side only (node:net) — jangan di-import dari komponen browser.
 */

import { Socket } from 'node:net';

/** Protocol version 1.21 — cukup untuk status ping (server tidak memvalidasi versi untuk status). */
const PROTOCOL_VERSION = 767;
const PING_TIMEOUT_MS = 3_000;

export interface JavaServerStatus {
  /** Server menjawab status ping. */
  online: boolean;
  playersOnline: number | null;
  playersMax: number | null;
  /** Nama player yang sedang online; null bila server tidak mengirim sample. */
  playerNames: string[] | null;
}

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return bytes;
}

/** Bungkus payload menjadi satu packet (varint length prefix + data). */
function packet(data: number[]): Buffer {
  return Buffer.from([...encodeVarint(data.length), ...data]);
}

function readVarint(buffer: Buffer, offset: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= buffer.length) return null;
    const byte = buffer[pos];
    pos += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) return null;
  }
  return { value, next: pos };
}

/** Parse response status (packet id 0x00 + JSON). null bila data belum lengkap. */
function tryParseStatusResponse(buffer: Buffer): JavaServerStatus | null {
  const length = readVarint(buffer, 0);
  if (!length) return null;
  if (buffer.length < length.next + length.value) return null;
  const body = buffer.subarray(length.next, length.next + length.value);
  const packetId = readVarint(body, 0);
  if (!packetId || packetId.value !== 0x00) return null;
  const jsonLength = readVarint(body, packetId.next);
  if (!jsonLength) return null;
  const jsonText = body
    .subarray(jsonLength.next, jsonLength.next + jsonLength.value)
    .toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  const root = parsed as {
    players?: { online?: unknown; max?: unknown; sample?: unknown };
  } | null;
  const players = root?.players;
  const sample = Array.isArray(players?.sample) ? players.sample : null;
  return {
    online: true,
    playersOnline: typeof players?.online === 'number' ? players.online : null,
    playersMax: typeof players?.max === 'number' ? players.max : null,
    playerNames: sample
      ? sample
          .map((entry) => (entry as { name?: unknown } | null)?.name)
          .filter((name): name is string => typeof name === 'string' && name.length > 0)
      : null,
  };
}

/**
 * Ping satu server Java via TCP status. Mengembalikan null bila server tidak
 * bisa dihubungi / tidak menjawab — null BUKAN berarti server pasti offline
 * (bisa juga status ping diblokir atau panel tidak punya route ke allocation).
 */
export function pingJavaServer(
  host: string,
  port: number,
  timeoutMs = PING_TIMEOUT_MS,
): Promise<JavaServerStatus | null> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let buffer = Buffer.alloc(0);
    let settled = false;

    const finish = (result: JavaServerStatus | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.on('error', () => finish(null));
    socket.on('close', () => finish(null));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const status = tryParseStatusResponse(buffer);
      if (status) finish(status);
    });
    socket.connect(port, host, () => {
      const hostBytes = Array.from(Buffer.from(host, 'utf8'));
      const handshake = packet([
        0x00,
        ...encodeVarint(PROTOCOL_VERSION),
        ...encodeVarint(hostBytes.length),
        ...hostBytes,
        (port >> 8) & 0xff,
        port & 0xff,
        ...encodeVarint(1), // next state: status
      ]);
      const statusRequest = packet([0x00]);
      socket.write(Buffer.concat([handshake, statusRequest]));
    });
  });
}

export type PlayerOnlineState = 'online' | 'offline' | 'unknown';

/**
 * Simpulkan apakah player sedang online dari hasil status ping.
 * 'unknown' bila status tidak bisa memastikan (ping gagal / sample tidak ada).
 */
export function resolvePlayerOnlineState(
  status: JavaServerStatus | null,
  playerName: string,
): PlayerOnlineState {
  if (!status) return 'unknown';
  if (status.playersOnline === 0) return 'offline';
  const names = status.playerNames;
  if (!names) return 'unknown';
  const target = playerName.toLowerCase();
  if (names.some((name) => name.toLowerCase() === target)) return 'online';
  // Server mengirim sample parsial → nama bisa saja tidak terdaftar walau online.
  if (status.playersOnline === null || status.playersOnline > names.length) return 'unknown';
  return 'offline';
}
