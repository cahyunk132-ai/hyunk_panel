import 'server-only';

import { posix as posixPath } from 'node:path';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import { decryptSecret } from '@/lib/storage/crypto';
import type { VpsRecord } from '@/lib/vps/access';

const SSH_READY_TIMEOUT_MS = 15_000;
const MAX_COMMAND_OUTPUT_BYTES = 512 * 1024;
export const MAX_FILE_READ_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export interface VpsCommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal?: string;
}

export interface VpsFileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  permissions: string;
  modified_at: string;
}

function connectionConfig(vps: VpsRecord): ConnectConfig {
  return {
    host: vps.host,
    port: vps.port,
    username: vps.username,
    password: decryptSecret(vps.credential),
    readyTimeout: SSH_READY_TIMEOUT_MS,
    keepaliveInterval: 10_000,
    keepaliveCountMax: 3,
  };
}

/** Run an operation over one SSH connection and always close it afterwards. */
export async function withSsh<T>(vps: VpsRecord, operation: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client();
  let ready = false;

  const connected = new Promise<void>((resolve, reject) => {
    client.on('error', (error) => {
      if (!ready) reject(error);
    });
    client.once('ready', () => {
      ready = true;
      resolve();
    });
  });

  try {
    client.connect(connectionConfig(vps));
    await connected;
    return await operation(client);
  } finally {
    client.end();
  }
}

function appendOutput(
  chunks: Buffer[],
  chunk: Buffer | string,
  currentBytes: { value: number },
): void {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  currentBytes.value += buffer.byteLength;
  if (currentBytes.value > MAX_COMMAND_OUTPUT_BYTES) {
    throw new Error('Output command terlalu besar');
  }
  chunks.push(buffer);
}

/** Execute a fixed or server-side command without exposing SSH credentials. */
export async function execVpsCommand(vps: VpsRecord, command: string): Promise<VpsCommandResult> {
  return withSsh(vps, (client) =>
    new Promise<VpsCommandResult>((resolve, reject) => {
      client.exec(command, (error, stream: ClientChannel) => {
        if (error) {
          reject(error);
          return;
        }

        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        const stdoutBytes = { value: 0 };
        const stderrBytes = { value: 0 };
        let outputTooLarge = false;

        stream.on('data', (chunk: Buffer | string) => {
          try {
            appendOutput(stdout, chunk, stdoutBytes);
          } catch {
            outputTooLarge = true;
            stream.destroy();
          }
        });
        stream.stderr.on('data', (chunk: Buffer | string) => {
          try {
            appendOutput(stderr, chunk, stderrBytes);
          } catch {
            outputTooLarge = true;
            stream.destroy();
          }
        });
        stream.on('error', (streamError: Error) => {
          if (!outputTooLarge) reject(streamError);
        });
        stream.on('close', (code: number | null, signal?: string) => {
          if (outputTooLarge) {
            reject(new Error('Output command terlalu besar'));
            return;
          }
          resolve({
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            code,
            signal,
          });
        });
      });
    }),
  );
}

async function withSftp<T>(vps: VpsRecord, operation: (sftp: SftpClient) => Promise<T>): Promise<T> {
  const sftp = new SftpClient();
  await sftp.connect(connectionConfig(vps));
  try {
    return await operation(sftp);
  } finally {
    await sftp.end().catch(() => undefined);
  }
}

/** Normalize to an absolute POSIX path without invoking a shell. */
export function normalizeVpsPath(input: string | null | undefined): string {
  if (input?.includes('\0')) throw new Error('Path tidak valid');
  const raw = (input ?? '/').trim() || '/';
  const normalized = posixPath.normalize(raw.startsWith('/') ? raw : `/${raw}`);
  return normalized === '.' ? '/' : normalized;
}

function filePermissions(rights: { user?: string; group?: string; other?: string } | undefined): string {
  if (!rights) return '---------';
  return `${rights.user ?? '---'}${rights.group ?? '---'}${rights.other ?? '---'}`;
}

export async function listVpsFiles(vps: VpsRecord, directory: string): Promise<VpsFileEntry[]> {
  const remoteDirectory = normalizeVpsPath(directory);
  return withSftp(vps, async (sftp) => {
    const entries = await sftp.list(remoteDirectory);
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.type === 'd' ? 'directory' : entry.type === 'l' ? 'symlink' : 'file',
      size: entry.size,
      permissions: filePermissions(entry.rights),
      modified_at: new Date(entry.modifyTime).toISOString(),
    }));
  });
}

async function getFileBuffer(vps: VpsRecord, filePath: string, maxBytes: number): Promise<Buffer> {
  const remoteFile = normalizeVpsPath(filePath);
  return withSftp(vps, async (sftp) => {
    const stat = await sftp.stat(remoteFile);
    if (stat.isDirectory) throw new Error('Path tersebut adalah folder');
    if (stat.size > maxBytes) throw new Error(`File terlalu besar (maksimal ${maxBytes} byte)`);
    const result = await sftp.get(remoteFile);
    if (!Buffer.isBuffer(result)) throw new Error('Data file tidak valid');
    return result;
  });
}

export async function readVpsFile(vps: VpsRecord, filePath: string): Promise<Buffer> {
  return getFileBuffer(vps, filePath, MAX_FILE_READ_BYTES);
}

export async function downloadVpsFile(vps: VpsRecord, filePath: string): Promise<Buffer> {
  return getFileBuffer(vps, filePath, MAX_FILE_DOWNLOAD_BYTES);
}

export async function writeVpsFile(vps: VpsRecord, filePath: string, content: string): Promise<void> {
  const remoteFile = normalizeVpsPath(filePath);
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.byteLength > MAX_FILE_READ_BYTES) throw new Error('Isi file terlalu besar');
  await withSftp(vps, async (sftp) => {
    await sftp.put(buffer, remoteFile);
  });
}

export async function makeVpsDirectory(vps: VpsRecord, directory: string): Promise<void> {
  await withSftp(vps, async (sftp) => {
    await sftp.mkdir(normalizeVpsPath(directory), false);
  });
}

export async function removeVpsPath(vps: VpsRecord, targetPath: string): Promise<void> {
  const remotePath = normalizeVpsPath(targetPath);
  if (remotePath === '/') throw new Error('Folder root tidak boleh dihapus');
  await withSftp(vps, async (sftp) => {
    const stat = await sftp.stat(remotePath);
    if (stat.isDirectory) await sftp.rmdir(remotePath, true);
    else await sftp.delete(remotePath);
  });
}

export async function renameVpsPath(vps: VpsRecord, fromPath: string, toPath: string): Promise<void> {
  const source = normalizeVpsPath(fromPath);
  const destination = normalizeVpsPath(toPath);
  if (source === '/' || destination === '/') throw new Error('Path root tidak dapat di-rename');
  await withSftp(vps, async (sftp) => {
    await sftp.rename(source, destination);
  });
}

export async function uploadVpsFile(vps: VpsRecord, filePath: string, content: Buffer): Promise<void> {
  if (content.byteLength > MAX_FILE_UPLOAD_BYTES) {
    throw new Error(`File terlalu besar (maksimal ${MAX_FILE_UPLOAD_BYTES} byte)`);
  }
  await withSftp(vps, async (sftp) => {
    await sftp.put(content, normalizeVpsPath(filePath));
  });
}
