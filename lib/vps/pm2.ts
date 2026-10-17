import 'server-only';

import { readVpsFile, writeVpsFile, execVpsCommand } from '@/lib/vps/ssh';
import type { VpsRecord } from '@/lib/vps/access';
import {
  assertCommandSucceeded,
  getVpsHomeDirectory,
  shellQuote,
  validateAppName,
  validateDeployPath,
  withPath,
  validateInterpreter,
  validateLineCount,
  validateScriptPath,
} from '@/lib/vps/commands';

export interface Pm2Process {
  id: string;
  name: string;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  pid: number | null;
  restarts: number;
  pm_id: number | null;
}

export type Pm2Action = 'start' | 'stop' | 'restart' | 'delete' | 'flush';

export const DEFAULT_ECOSYSTEM = `module.exports = {
  apps: []
};
`;

function parseJsonArray(output: string): unknown[] {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('Output pm2 jlist bukan JSON array');
  const parsed: unknown = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Output pm2 jlist tidak valid');
  return parsed;
}

function numberOr(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}

export function parsePm2Processes(output: string): Pm2Process[] {
  return parseJsonArray(output).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const app = raw as {
      name?: unknown;
      pid?: unknown;
      pm_id?: unknown;
      monit?: { cpu?: unknown; memory?: unknown };
      pm2_env?: { status?: unknown; pm_uptime?: unknown; restart_time?: unknown };
    };
    const pmId = Number.isInteger(Number(app.pm_id)) ? Number(app.pm_id) : null;
    const pid = Number.isInteger(Number(app.pid)) && Number(app.pid) > 0 ? Number(app.pid) : null;
    const pmUptime = numberOr(app.pm2_env?.pm_uptime, 0);
    return [
      {
        id: String(pmId ?? app.name ?? ''),
        name: textOr(app.name, 'unknown'),
        status: textOr(app.pm2_env?.status, 'unknown'),
        cpu: numberOr(app.monit?.cpu),
        memory: Math.round(numberOr(app.monit?.memory) / (1024 * 1024)),
        uptime: pmUptime > 0 ? Math.max(0, Date.now() - pmUptime) : 0,
        pid,
        restarts: numberOr(app.pm2_env?.restart_time),
        pm_id: pmId,
      },
    ];
  });
}

export async function getPm2Processes(vps: VpsRecord): Promise<Pm2Process[]> {
  const result = await execVpsCommand(vps, withPath('pm2 jlist'));
  const output = assertCommandSucceeded(result, 'Gagal membaca daftar proses PM2');
  return parsePm2Processes(output);
}

function pm2Target(name: unknown): string {
  return shellQuote(validateAppName(name));
}

export async function runPm2Action(vps: VpsRecord, action: Pm2Action, name?: unknown): Promise<string> {
  const target = name === undefined || name === null || name === '' ? undefined : pm2Target(name);
  if (!target && action !== 'flush') throw new Error(`Nama proses wajib untuk action ${action}`);
  const commands: Record<Pm2Action, string> = {
    start: withPath(`pm2 start ${target ?? ''}`),
    stop: withPath(`pm2 stop ${target ?? ''}`),
    restart: withPath(`pm2 restart ${target ?? ''}`),
    delete: withPath(`pm2 delete ${target ?? ''} && pm2 save`),
    flush: withPath(`pm2 flush${target ? ` ${target}` : ''}`),
  };
  const result = await execVpsCommand(vps, commands[action]);
  return assertCommandSucceeded(result, `PM2 gagal menjalankan action ${action}`);
}

export async function createPm2Process(
  vps: VpsRecord,
  input: { name: unknown; script: unknown; interpreter?: unknown; cwd?: unknown },
): Promise<string> {
  const name = shellQuote(validateAppName(input.name));
  const script = shellQuote(validateScriptPath(input.script));
  const interpreter = validateInterpreter(input.interpreter);
  const cwd = input.cwd === undefined || input.cwd === '' ? undefined : validateDeployPath(input.cwd);
  const options = [
    `--name ${name}`,
    interpreter ? `--interpreter ${shellQuote(interpreter)}` : '',
    cwd ? `--cwd ${shellQuote(cwd)}` : '',
  ].filter(Boolean);
  const result = await execVpsCommand(
    vps,
    withPath(`pm2 start ${script} ${options.join(' ')} && pm2 save`),
  );
  return assertCommandSucceeded(result, 'Gagal membuat proses PM2');
}

function splitLogLines(output: string, lines: number): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-lines);
}

export async function getPm2Logs(vps: VpsRecord, name: unknown, requestedLines: unknown): Promise<string[]> {
  const safeName = validateAppName(name);
  const lines = validateLineCount(requestedLines);
  const result = await execVpsCommand(
    vps,
    withPath(`pm2 logs ${shellQuote(safeName)} --lines ${lines} --nostream`),
  );
  const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
  if (result.code === 0 && combined.trim()) return splitLogLines(combined, lines);

  const home = getVpsHomeDirectory(vps);
  const outLog = `${home}/.pm2/logs/${safeName}-out.log`;
  const errorLog = `${home}/.pm2/logs/${safeName}-error.log`;
  const fallback = await execVpsCommand(
    vps,
    `tail -n ${lines} -- ${shellQuote(outLog)} ${shellQuote(errorLog)} 2>/dev/null`,
  );
  if (fallback.code !== 0 && !fallback.stdout.trim()) {
    throw new Error(combined.trim() || fallback.stderr.trim() || 'Log PM2 tidak tersedia');
  }
  return splitLogLines([fallback.stdout, fallback.stderr].filter(Boolean).join('\n'), lines);
}

export function ecosystemPath(vps: VpsRecord): string {
  return `${getVpsHomeDirectory(vps)}/ecosystem.config.js`;
}

export async function readEcosystem(vps: VpsRecord): Promise<string> {
  const path = ecosystemPath(vps);
  const exists = await execVpsCommand(vps, `test -f ${shellQuote(path)}`);
  if (exists.code === 1) return DEFAULT_ECOSYSTEM;
  if (exists.code !== 0) throw new Error('Gagal memeriksa ecosystem.config.js');
  const content = await readVpsFile(vps, path);
  return content.toString('utf8');
}

export async function writeEcosystem(vps: VpsRecord, content: unknown): Promise<void> {
  if (typeof content !== 'string' || content.length > 2 * 1024 * 1024) {
    throw new Error('Isi ecosystem.config.js tidak valid atau terlalu besar');
  }
  await writeVpsFile(vps, ecosystemPath(vps), content);
}
