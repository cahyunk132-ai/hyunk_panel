// ─── Utilitas allocation/port (dipakai server & client) ─────────────────────
// Format input yang didukung: "25565", "25565-25600", "25565,25570-25572".

/** Batas aman jumlah port yang boleh dibuat dalam satu permintaan. */
export const MAX_PORTS_PER_REQUEST = 2000;

export interface ParsedPortSpec {
  ports: number[];
  error: string | null;
}

/**
 * Parse spesifikasi port menjadi daftar port unik & terurut.
 * Tidak pernah melempar error — kegagalan dikembalikan lewat `error`.
 */
export function parsePortSpec(input: string, max: number = MAX_PORTS_PER_REQUEST): ParsedPortSpec {
  // "25565 - 25600" → "25565-25600" supaya spasi di sekitar tanda hubung tidak mengganggu.
  const raw = (input ?? '').replace(/\s*-\s*/g, '-').trim();
  if (!raw) return { ports: [], error: 'Port wajib diisi.' };

  const ports = new Set<number>();
  for (const chunk of raw.split(/[,\s]+/)) {
    if (!chunk) continue;
    const match = /^(\d{1,5})\s*-\s*(\d{1,5})$|^(\d{1,5})$/.exec(chunk);
    if (!match) {
      return { ports: [], error: `Format "${chunk}" tidak valid. Gunakan 25565 atau 25565-25600.` };
    }
    const start = Number(match[1] ?? match[3]);
    const end = match[2] !== undefined ? Number(match[2]) : start;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535) {
      return { ports: [], error: 'Port harus berada di antara 1 dan 65535.' };
    }
    if (end < start) {
      return { ports: [], error: `Range "${chunk}" terbalik: ${start} lebih besar dari ${end}.` };
    }
    if (end - start + 1 > max) {
      return { ports: [], error: `Satu permintaan maksimal ${max} port.` };
    }
    for (let port = start; port <= end; port += 1) ports.add(port);
  }

  if (ports.size === 0) return { ports: [], error: 'Tidak ada port yang terbaca.' };
  if (ports.size > max) return { ports: [], error: `Satu permintaan maksimal ${max} port.` };
  return { ports: Array.from(ports).sort((a, b) => a - b), error: null };
}

/** Ringkas daftar port menjadi range: [25565,25566,25570] → "25565-25566, 25570". */
export function formatPortRanges(ports: number[]): string {
  const sorted = Array.from(new Set(ports)).sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | null = null;
  let prev: number | null = null;

  for (const port of sorted) {
    if (start === null || prev === null) {
      start = port;
      prev = port;
      continue;
    }
    if (port === prev + 1) {
      prev = port;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = port;
    prev = port;
  }
  if (start !== null && prev !== null) {
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
  }
  return parts.join(', ');
}

/** Validasi IP allocation: IPv4, IPv6, atau hostname sederhana. */
export function isValidAllocationIp(ip: string): boolean {
  const value = (ip ?? '').trim();
  if (!value || value.length > 64) return false;
  return /^[0-9a-fA-F.:]+$/.test(value) || /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(value);
}

/** "0.0.0.0:25565" — dipakai di UI dan log. */
export function formatAllocation(ip: string, port: number): string {
  const host = ip.includes(':') ? `[${ip}]` : ip;
  return `${host}:${port}`;
}
