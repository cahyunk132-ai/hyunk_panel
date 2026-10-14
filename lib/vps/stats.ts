import 'server-only';

import { execVpsCommand } from '@/lib/vps/ssh';
import type { VpsRecord } from '@/lib/vps/access';

export interface VpsStats {
  cpu: number;
  cpu_model: string;
  ram: { used: number; total: number };
  disk: { used: string; total: string; percent: string };
}

const CPU_MODEL_SCRIPT = `CPU_MODEL="$(lscpu 2>/dev/null | awk -F: '/Model name|Model/ {gsub(/^[[:space:]]+/, "", $2); if ($2 != "") {print $2; exit}}')"; if [ -z "$CPU_MODEL" ]; then CPU_MODEL="$(awk -F: '/model name|Hardware|Processor/ {gsub(/^[[:space:]]+/, "", $2); if ($2 != "") {print $2; exit}}' /proc/cpuinfo 2>/dev/null)"; fi`;
const CPU_MODEL_COMMAND = `${CPU_MODEL_SCRIPT}; echo "CPU_MODEL:$CPU_MODEL"`;
const STATS_COMMAND = `${CPU_MODEL_SCRIPT}; echo "CPU_MODEL:$CPU_MODEL" && \\
echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1)" && \\
echo "RAM:$(free -m | awk 'NR==2{printf "%s/%s", $3,$2}')" && \\
echo "DISK:$(df -h / | awk 'NR==2{printf "%s/%s/%s", $3,$2,$5}')`;

/** Parse the compact output emitted by STATS_COMMAND. */
export function parseVpsStats(output: string): VpsStats {
  const lines = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    lines.set(line.slice(0, separator).trim().toUpperCase(), line.slice(separator + 1).trim());
  }

  const cpu = Number.parseFloat(lines.get('CPU') ?? '');
  const cpuModel = lines.get('CPU_MODEL')?.trim() || 'Unknown CPU';
  const ramParts = (lines.get('RAM') ?? '').split('/');
  const diskParts = (lines.get('DISK') ?? '').split('/');
  const ramUsed = Number.parseInt(ramParts[0] ?? '', 10);
  const ramTotal = Number.parseInt(ramParts[1] ?? '', 10);

  if (!Number.isFinite(cpu) || !Number.isFinite(ramUsed) || !Number.isFinite(ramTotal) || ramTotal <= 0) {
    throw new Error('Format statistik VPS tidak valid');
  }
  if (diskParts.length !== 3 || !diskParts[0] || !diskParts[1] || !diskParts[2]) {
    throw new Error('Format disk VPS tidak valid');
  }

  return {
    cpu: Math.min(100, Math.max(0, Number(cpu.toFixed(1)))),
    cpu_model: cpuModel,
    ram: { used: Math.max(0, ramUsed), total: Math.max(0, ramTotal) },
    disk: {
      used: diskParts[0],
      total: diskParts[1],
      percent: diskParts[2].endsWith('%') ? diskParts[2] : `${diskParts[2]}%`,
    },
  };
}

export function parseVpsCpuModel(output: string): string {
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    if (line.slice(0, separator).trim().toUpperCase() !== 'CPU_MODEL') continue;
    return line.slice(separator + 1).trim() || 'Unknown CPU';
  }
  return 'Unknown CPU';
}

interface CachedStats {
  expiresAt: number;
  value: VpsStats;
}

interface CachedCpuModel {
  expiresAt: number;
  value: string;
}

const statsCache = new Map<string, CachedStats>();
const cpuModelCache = new Map<string, CachedCpuModel>();
const CACHE_TTL_MS = 10_000;
const CPU_MODEL_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Cache process-local results for 10 seconds. This prevents every card from
 * opening a new SSH connection on every render while remaining near-realtime.
 */
export async function getVpsStats(vps: VpsRecord): Promise<VpsStats> {
  const cached = statsCache.get(vps.id);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) statsCache.delete(vps.id);

  const result = await execVpsCommand(vps, STATS_COMMAND);
  if (result.code !== null && result.code !== 0) {
    throw new Error(result.stderr.trim() || 'Command statistik gagal dijalankan');
  }
  const value = parseVpsStats(result.stdout);
  statsCache.set(vps.id, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

/**
 * Read only the CPU model on demand over SSH. This endpoint is intentionally
 * independent from Vercel Cron: the browser requests it when the VPS card is
 * rendered, while the process-local cache avoids repeating the slow SSH call.
 */
export async function getVpsCpuModel(vps: VpsRecord): Promise<string> {
  const cached = cpuModelCache.get(vps.id);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) cpuModelCache.delete(vps.id);

  const result = await execVpsCommand(vps, CPU_MODEL_COMMAND);
  if (result.code !== null && result.code !== 0) {
    throw new Error(result.stderr.trim() || 'Command CPU model gagal dijalankan');
  }
  const value = parseVpsCpuModel(result.stdout);
  cpuModelCache.set(vps.id, {
    expiresAt: Date.now() + CPU_MODEL_CACHE_TTL_MS,
    value,
  });
  return value;
}
