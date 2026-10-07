import 'server-only';

import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WingsClient } from '@/lib/wings/client';
import { WingsError } from '@/lib/wings/client';
import type { WingsFileStat } from '@/lib/wings/types';

const MODRINTH_CDN_HOST = 'cdn.modrinth.com';
const MODRINTH_USER_AGENT = 'HyunkPanel/0.1 (Bedrock addon installer)';
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 5_000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const DEFAULT_WORLD_NAME = 'Bedrock level';
const PACK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, unknown>;
export type BedrockPackKind = 'behavior' | 'resource';
export type BedrockAddonType = BedrockPackKind | 'addon';

export interface InstalledBedrockAddon {
  pack_id: string;
  pack_name: string;
  type: BedrockPackKind;
  version: string;
  folder: string;
  active: boolean;
}

export class BedrockAddonError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = 'BedrockAddonError';
  }
}

interface PackManifest {
  packId: string;
  name: string;
  version: number[];
  kind: BedrockPackKind;
  requiresEducationFeatures: boolean;
}

interface PreparedFile {
  entry: JSZip.JSZipObject;
  relativePath: string;
  size: number | null;
}

interface PreparedPack {
  manifest: PackManifest;
  files: PreparedFile[];
  folder: string;
}

interface PackConfig {
  path: string;
  entries: unknown[];
  originalText: string | null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wingsStatus(error: unknown): number | null {
  return error instanceof WingsError ? error.status : null;
}

function normalizePackId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  return PACK_ID_RE.test(id) ? id : null;
}

function packIdFromConfigEntry(value: unknown): string | null {
  return isRecord(value) ? normalizePackId(value.pack_id) : null;
}

function isSafeFolderSegment(value: string): boolean {
  return Boolean(
    value &&
      value !== '.' &&
      value !== '..' &&
      value.length <= 240 &&
      !value.includes('/') &&
      !value.includes('\\') &&
      !value.includes('\0'),
  );
}

function getZipEntrySize(entry: JSZip.JSZipObject): number | null {
  // JSZip keeps the central-directory size on its internal data object after loadAsync.
  // Keeping this read isolated lets us enforce limits before opening an entry stream.
  const data = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: unknown } })._data;
  const size = data?.uncompressedSize;
  return typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : null;
}

function checkedArchivePath(entry: JSZip.JSZipObject): string {
  const original = entry.unsafeOriginalName ?? entry.name;
  if (
    !original ||
    original.includes('\0') ||
    /[\u0001-\u001f\u007f]/.test(original) ||
    original.includes('\\') ||
    original.startsWith('/') ||
    /^[a-z]:/i.test(original)
  ) {
    throw new BedrockAddonError('Arsip berisi path file yang tidak aman', 400);
  }

  const trimmed = entry.dir ? original.replace(/\/+$/, '') : original;
  // Harmless leading `./` is emitted by some ZIP tools; collapse it while
  // still rejecting every `..` traversal segment.
  const segments = trimmed.split('/').filter((segment) => segment && segment !== '.');
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '..') ||
    segments.some((segment) => segment.length > 240)
  ) {
    throw new BedrockAddonError('Arsip berisi path file yang tidak aman', 400);
  }
  return segments.join('/');
}

function slugifyFolderName(name: string, packId: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 64);
  return `${slug || 'bedrock-pack'}-${packId.slice(0, 8)}`;
}

function parseManifest(text: string, fallbackName: string): PackManifest {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new BedrockAddonError('manifest.json di dalam pack bukan JSON yang valid', 400);
  }
  if (!isRecord(value) || !isRecord(value.header)) {
    throw new BedrockAddonError('manifest.json tidak memiliki bagian header yang valid', 400);
  }

  const header = value.header;
  const packId = normalizePackId(header.uuid);
  if (!packId) {
    throw new BedrockAddonError('manifest.json tidak memiliki header.uuid yang valid', 400);
  }

  if (
    !Array.isArray(header.version) ||
    header.version.length < 3 ||
    header.version.slice(0, 3).some(
      (part) => typeof part !== 'number' || !Number.isInteger(part) || part < 0 || part > 2_147_483_647,
    )
  ) {
    throw new BedrockAddonError('manifest.json tidak memiliki header.version tiga angka yang valid', 400);
  }

  const modules = Array.isArray(value.modules) ? value.modules.filter(isRecord) : [];
  const moduleTypes = modules
    .map((module) => (typeof module.type === 'string' ? module.type.toLowerCase() : ''))
    .filter(Boolean);
  const isResource = moduleTypes.includes('resources');
  const isBehavior = moduleTypes.some((type) => ['data', 'script', 'client_data'].includes(type));
  if (isResource && isBehavior) {
    throw new BedrockAddonError(
      'Pack memiliki module resource dan behavior dalam satu manifest; pisahkan menjadi file .mcpack terpisah',
      400,
    );
  }
  if (!isResource && !isBehavior) {
    throw new BedrockAddonError('Jenis pack tidak dikenali dari modules[].type di manifest.json', 400);
  }

  const capabilities = [
    ...(Array.isArray(value.capabilities) ? value.capabilities : []),
    ...(Array.isArray(header.capabilities) ? header.capabilities : []),
  ];
  const requiresEducationFeatures = capabilities.some(
    (capability) =>
      typeof capability === 'string' &&
      (capability.toLowerCase() === 'chemistry' || capability.toLowerCase().includes('education')),
  );

  const name = typeof header.name === 'string' && header.name.trim() ? header.name.trim() : fallbackName;
  return {
    packId,
    name,
    version: header.version.slice(0, 3) as number[],
    kind: isResource ? 'resource' : 'behavior',
    requiresEducationFeatures,
  };
}

async function preparePack(archive: JSZip, fallbackName: string): Promise<PreparedPack> {
  const entries = Object.values(archive.files);
  if (entries.length === 0 || entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new BedrockAddonError('Arsip pack kosong atau berisi terlalu banyak file', 413);
  }

  const files = entries.filter((entry) => !entry.dir);
  const paths = new Map<JSZip.JSZipObject, string>();
  for (const entry of files) paths.set(entry, checkedArchivePath(entry));

  const manifests = files
    .filter((entry) => basename(paths.get(entry) ?? '').toLowerCase() === 'manifest.json')
    .sort((a, b) => (paths.get(a)!.split('/').length - paths.get(b)!.split('/').length));
  const manifestEntry = manifests[0];
  if (!manifestEntry) {
    throw new BedrockAddonError('Tidak menemukan manifest.json di dalam file pack', 400);
  }

  const manifestSize = getZipEntrySize(manifestEntry);
  if (manifestSize !== null && manifestSize > MAX_MANIFEST_BYTES) {
    throw new BedrockAddonError('manifest.json terlalu besar', 413);
  }
  const manifestText = await manifestEntry.async('string');
  if (Buffer.byteLength(manifestText, 'utf8') > MAX_MANIFEST_BYTES) {
    throw new BedrockAddonError('manifest.json terlalu besar', 413);
  }
  const manifestPath = paths.get(manifestEntry)!;
  const wrapper = manifestPath.includes('/') ? manifestPath.slice(0, manifestPath.lastIndexOf('/')) : '';
  const manifest = parseManifest(manifestText, fallbackName);

  let totalDeclaredBytes = 0;
  const preparedFiles: PreparedFile[] = [];
  for (const entry of files) {
    const path = paths.get(entry)!;
    // Some pack zips have a top-level wrapper folder while others put manifest.json at the root.
    // When the manifest is nested, keep only that pack's subtree (README/license files beside it are ignored).
    if (wrapper && !path.startsWith(`${wrapper}/`)) continue;
    const relativePath = wrapper ? path.slice(wrapper.length + 1) : path;
    if (!relativePath) continue;
    const size = getZipEntrySize(entry);
    if (size !== null) {
      totalDeclaredBytes += size;
      if (totalDeclaredBytes > MAX_UNPACKED_BYTES) {
        throw new BedrockAddonError('Isi pack hasil extract melebihi batas 512 MB', 413);
      }
    }
    preparedFiles.push({ entry, relativePath, size });
  }
  if (preparedFiles.length === 0) {
    throw new BedrockAddonError('Pack tidak memiliki file yang dapat dipasang', 400);
  }

  return {
    manifest,
    files: preparedFiles,
    folder: slugifyFolderName(manifest.name, manifest.packId),
  };
}

function validateModrinthUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BedrockAddonError('URL file Modrinth tidak valid', 400);
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== MODRINTH_CDN_HOST ||
    (url.port !== '' && url.port !== '443') ||
    url.username ||
    url.password
  ) {
    throw new BedrockAddonError('URL unduhan harus berasal dari CDN resmi Modrinth', 400);
  }
  return url;
}

function validateFilename(value: string, projectType: string): string {
  const filename = value.trim();
  if (!filename || filename.length > 180 || filename.includes('/') || filename.includes('\\') || /[\u0000-\u001f]/.test(filename)) {
    throw new BedrockAddonError('Nama file Modrinth tidak valid', 400);
  }
  const lower = filename.toLowerCase();
  const isMcpack = lower.endsWith('.mcpack');
  const isMcaddon = lower.endsWith('.mcaddon');
  if (!isMcpack && !isMcaddon) {
    throw new BedrockAddonError('File harus berformat .mcpack atau .mcaddon', 400);
  }
  if (projectType === 'resourcepack' && !isMcpack) {
    throw new BedrockAddonError('Resource Pack harus diunduh sebagai file .mcpack', 400);
  }
  if (projectType !== 'mod' && projectType !== 'resourcepack') {
    throw new BedrockAddonError('project_type harus berupa mod atau resourcepack', 400);
  }
  if (projectType === 'resourcepack' && isMcaddon) {
    throw new BedrockAddonError('File .mcaddon harus memiliki project_type mod', 400);
  }
  return filename;
}

async function downloadToFile(urlValue: string, destination: string): Promise<number> {
  let url = validateModrinthUrl(urlValue);
  let response: Response | null = null;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    response = await fetch(url, {
      headers: { 'User-Agent': MODRINTH_USER_AGENT, Accept: 'application/octet-stream' },
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(3 * 60 * 1000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;

    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (!location || redirectCount === 3) {
      throw new BedrockAddonError('Redirect unduhan Modrinth tidak valid atau terlalu banyak', 502);
    }
    url = validateModrinthUrl(new URL(location, url).toString());
  }

  if (!response?.ok || !response.body) {
    await response?.body?.cancel().catch(() => undefined);
    throw new BedrockAddonError(`Gagal mengunduh file dari Modrinth (${response?.status ?? 'network error'})`, 502);
  }

  const finalUrl = validateModrinthUrl(response.url || url.toString());
  if (finalUrl.hostname.toLowerCase() !== MODRINTH_CDN_HOST) {
    await response.body.cancel();
    throw new BedrockAddonError('Redirect file Modrinth menuju host yang tidak diizinkan', 502);
  }

  const contentLengthHeader = response.headers.get('content-length');
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
    await response.body.cancel();
    throw new BedrockAddonError('Ukuran file melebihi batas 100 MB', 413);
  }

  let downloaded = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      downloaded += chunk.byteLength;
      if (downloaded > MAX_ARCHIVE_BYTES) {
        callback(new BedrockAddonError('Ukuran file melebihi batas 100 MB', 413));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    // The CDN response is streamed to a temporary file. JSZip currently needs the bounded
    // compressed archive in memory to parse its central directory; extracted entries below
    // are streamed individually to Wings rather than materialized as full buffers.
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      limiter,
      createWriteStream(destination, { flags: 'wx' }),
    );
  } catch (error) {
    throw error instanceof BedrockAddonError
      ? error
      : new BedrockAddonError(error instanceof Error ? error.message : 'Unduhan Modrinth terputus', 502);
  }

  if (Number.isFinite(contentLength) && downloaded !== contentLength) {
    throw new BedrockAddonError('Unduhan dari Modrinth terputus sebelum selesai', 502);
  }
  return downloaded;
}

async function loadZipFromBytes(bytes: Buffer): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  } catch {
    throw new BedrockAddonError('File yang diunduh bukan arsip ZIP/.mcpack yang valid', 400);
  }
}

async function prepareDownloadedArchive(
  bytes: Buffer,
  filename: string,
): Promise<{ packs: PreparedPack[]; isAddon: boolean }> {
  const extension = filename.toLowerCase();
  const isAddon = extension.endsWith('.mcaddon');
  const outerZip = await loadZipFromBytes(bytes);
  if (Object.keys(outerZip.files).length > MAX_ARCHIVE_ENTRIES) {
    throw new BedrockAddonError('Arsip berisi terlalu banyak file', 413);
  }

  if (!isAddon) {
    return {
      packs: [await preparePack(outerZip, filename.replace(/\.mcpack$/i, ''))],
      isAddon: false,
    };
  }

  const nestedPackEntries = Object.values(outerZip.files).filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.mcpack'),
  );
  if (nestedPackEntries.length === 0) {
    // A few tools produce a .mcaddon with a pack directly at the archive root.
    return { packs: [await preparePack(outerZip, filename.replace(/\.mcaddon$/i, ''))], isAddon: true };
  }
  if (nestedPackEntries.length > 20) {
    throw new BedrockAddonError('.mcaddon berisi terlalu banyak file .mcpack', 413);
  }

  const prepared: PreparedPack[] = [];
  for (const nested of nestedPackEntries) {
    const nestedSize = getZipEntrySize(nested);
    if (nestedSize !== null && nestedSize > MAX_ARCHIVE_BYTES) {
      throw new BedrockAddonError(`File ${basename(nested.name)} melebihi batas 100 MB`, 413);
    }
    const nestedBytes = await nested.async('nodebuffer');
    if (nestedBytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new BedrockAddonError(`File ${basename(nested.name)} melebihi batas 100 MB`, 413);
    }
    const nestedZip = await loadZipFromBytes(nestedBytes);
    prepared.push(await preparePack(nestedZip, basename(nested.name).replace(/\.mcpack$/i, '')));
  }

  if (prepared.length === 0) throw new BedrockAddonError('.mcaddon tidak berisi pack yang dapat dipasang', 400);
  const packIds = new Set<string>();
  for (const pack of prepared) {
    if (packIds.has(pack.manifest.packId)) {
      throw new BedrockAddonError('.mcaddon memiliki pack_id yang duplikat', 400);
    }
    packIds.add(pack.manifest.packId);
  }
  return { packs: prepared, isAddon: true };
}

async function listDirectoryOrMissing(
  client: WingsClient,
  serverUuid: string,
  directory: string,
): Promise<WingsFileStat[]> {
  try {
    return await client.listFiles(serverUuid, directory);
  } catch (error) {
    if (wingsStatus(error) === 404) return [];
    throw error;
  }
}

async function readTextOrMissing(client: WingsClient, serverUuid: string, file: string): Promise<string | null> {
  try {
    return await client.getFileContents(serverUuid, file);
  } catch (error) {
    if (wingsStatus(error) === 404) return null;
    throw error;
  }
}

function readLevelName(properties: string | null): string {
  if (properties) {
    for (const line of properties.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const match = line.match(/^\s*level-name\s*=\s*(.*?)\s*$/i);
      if (match?.[1]) {
        const value = match[1].trim();
        if (
          value &&
          value.length <= 120 &&
          value !== '.' &&
          value !== '..' &&
          !value.includes('/') &&
          !value.includes('\\') &&
          !value.includes('\0')
        ) {
          return value;
        }
      }
    }
  }
  return DEFAULT_WORLD_NAME;
}

async function resolveWorldPackDirectory(client: WingsClient, serverUuid: string): Promise<string> {
  const properties = await readTextOrMissing(client, serverUuid, '/server.properties');
  const worldName = readLevelName(properties);
  const worlds = await listDirectoryOrMissing(client, serverUuid, '/worlds');
  const worldExists = worlds.some((entry) => entry.directory && entry.name === worldName);
  if (worldExists) return `/worlds/${worldName}`;

  // Prefer the active-world location for new servers, but continue to support older setups
  // that kept these two JSON files in the server root.
  const root = await listDirectoryOrMissing(client, serverUuid, '/');
  if (
    root.some(
      (entry) =>
        entry.name === 'world_behavior_packs.json' || entry.name === 'world_resource_packs.json',
    )
  ) {
    return '/';
  }
  return `/worlds/${worldName}`;
}

function configPath(directory: string, filename: string): string {
  return `${directory === '/' ? '' : directory}/${filename}`;
}

async function readPackConfig(client: WingsClient, serverUuid: string, path: string): Promise<PackConfig> {
  const originalText = await readTextOrMissing(client, serverUuid, path);
  if (originalText === null || originalText.trim() === '') return { path, entries: [], originalText };

  let value: unknown;
  try {
    value = JSON.parse(originalText.replace(/^\uFEFF/, ''));
  } catch {
    throw new BedrockAddonError(
      `${path} bukan JSON valid; perbaiki file sebelum mengelola addon dari panel`,
      502,
    );
  }
  if (!Array.isArray(value)) {
    throw new BedrockAddonError(`${path} harus berisi array JSON`, 502);
  }
  return { path, entries: value, originalText };
}

async function writePackConfig(client: WingsClient, serverUuid: string, config: PackConfig): Promise<void> {
  await client.writeFile(serverUuid, config.path, `${JSON.stringify(config.entries, null, 2)}\n`);
}

async function restorePackConfig(
  client: WingsClient,
  serverUuid: string,
  config: PackConfig,
): Promise<void> {
  if (config.originalText === null) {
    await client.deleteFiles(serverUuid, '/', [config.path.replace(/^\//, '')]);
  } else {
    await client.writeFile(serverUuid, config.path, config.originalText);
  }
}

async function ensureDirectory(
  client: WingsClient,
  serverUuid: string,
  fullPath: string,
  ensured: Set<string>,
): Promise<Set<string>> {
  const created = new Set<string>();
  const segments = fullPath.split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    const parent = current || '/';
    const next = `${current}/${segment}`;
    if (ensured.has(next)) {
      current = next;
      continue;
    }
    const entries = await client.listFiles(serverUuid, parent);
    const existing = entries.find((entry) => entry.name === segment);
    if (existing && !existing.directory) {
      throw new BedrockAddonError(`Tidak bisa membuat folder ${fullPath}: "${segment}" sudah ada sebagai file`, 409);
    }
    if (!existing) {
      await client.createDirectory(serverUuid, parent, segment);
      created.add(next);
    }
    ensured.add(next);
    current = next;
  }
  return created;
}

function boundedEntryStream(
  entry: JSZip.JSZipObject,
  expectedSize: number | null,
  total: { bytes: number },
): ReadableStream<Uint8Array> {
  let entryBytes = 0;
  const nodeStream = entry.nodeStream('nodebuffer') as Readable;
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return webStream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        entryBytes += chunk.byteLength;
        total.bytes += chunk.byteLength;
        if (entryBytes > MAX_UNPACKED_BYTES || total.bytes > MAX_UNPACKED_BYTES) {
          throw new BedrockAddonError('Isi pack hasil extract melebihi batas 512 MB', 413);
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (expectedSize !== null && entryBytes !== expectedSize) {
          throw new BedrockAddonError('Ekstraksi file dari arsip tidak lengkap', 400);
        }
      },
    }),
  );
}

function packRoot(kind: BedrockPackKind): string {
  return kind === 'resource' ? '/resource_packs' : '/behavior_packs';
}

function configFilename(kind: BedrockPackKind): string {
  return kind === 'resource' ? 'world_resource_packs.json' : 'world_behavior_packs.json';
}

async function removePackFolders(
  client: WingsClient,
  serverUuid: string,
  folders: Array<{ kind: BedrockPackKind; folder: string }>,
): Promise<void> {
  let firstError: unknown;
  for (const item of folders) {
    try {
      await client.deleteFiles(serverUuid, packRoot(item.kind), [item.folder]);
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
}

export async function listInstalledBedrockAddons(
  client: WingsClient,
  serverUuid: string,
): Promise<{ addons: InstalledBedrockAddon[] }> {
  const worldDirectory = await resolveWorldPackDirectory(client, serverUuid);
  const [behaviorConfig, resourceConfig, behaviorFolders, resourceFolders] = await Promise.all([
    readPackConfig(client, serverUuid, configPath(worldDirectory, 'world_behavior_packs.json')),
    readPackConfig(client, serverUuid, configPath(worldDirectory, 'world_resource_packs.json')),
    listDirectoryOrMissing(client, serverUuid, '/behavior_packs'),
    listDirectoryOrMissing(client, serverUuid, '/resource_packs'),
  ]);

  const activeBehavior = new Set(
    behaviorConfig.entries
      .map(packIdFromConfigEntry)
      .filter((id): id is string => id !== null),
  );
  const activeResource = new Set(
    resourceConfig.entries
      .map(packIdFromConfigEntry)
      .filter((id): id is string => id !== null),
  );
  const folders: Array<{ kind: BedrockPackKind; folder: string; activeIds: Set<string> }> = [
    ...behaviorFolders
      .filter((entry) => entry.directory && isSafeFolderSegment(entry.name))
      .map((entry) => ({ kind: 'behavior' as const, folder: entry.name, activeIds: activeBehavior })),
    ...resourceFolders
      .filter((entry) => entry.directory && isSafeFolderSegment(entry.name))
      .map((entry) => ({ kind: 'resource' as const, folder: entry.name, activeIds: activeResource })),
  ];

  const addons = await Promise.all(
    folders.map(async ({ kind, folder, activeIds }) => {
      try {
        const raw = await client.getFileContents(serverUuid, `${packRoot(kind)}/${folder}/manifest.json`);
        const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
        if (!isRecord(parsed) || !isRecord(parsed.header)) return null;
        const packId = normalizePackId(parsed.header.uuid);
        if (!packId) return null;
        const version = Array.isArray(parsed.header.version)
          ? parsed.header.version.slice(0, 3).join('.')
          : '—';
        const name = typeof parsed.header.name === 'string' && parsed.header.name.trim()
          ? parsed.header.name.trim()
          : folder;
        return {
          pack_id: packId,
          pack_name: name,
          type: kind,
          version,
          folder,
          active: activeIds.has(packId),
        } satisfies InstalledBedrockAddon;
      } catch (error) {
        if (wingsStatus(error) === 404) return null;
        // A malformed manifest should not make every other installed pack disappear.
        if (error instanceof SyntaxError) return null;
        throw error;
      }
    }),
  );

  return {
    addons: addons
      .filter((addon): addon is InstalledBedrockAddon => addon !== null)
      .sort((a, b) => a.pack_name.localeCompare(b.pack_name, 'id-ID')),
  };
}

export async function installBedrockAddon(
  client: WingsClient,
  serverUuid: string,
  input: { file_url: string; filename: string; project_type: string },
): Promise<{
  pack_id: string;
  pack_name: string;
  type: BedrockAddonType;
  packs: Array<{ pack_id: string; pack_name: string; type: BedrockPackKind; version: string }>;
  requires_education_features: boolean;
}> {
  const projectType = input.project_type.trim().toLowerCase();
  const filename = validateFilename(input.filename, projectType);
  const fileUrl = validateModrinthUrl(input.file_url);
  const tempDirectory = await mkdtemp(join(tmpdir(), 'hyunk-bedrock-addon-'));
  const archivePath = join(tempDirectory, `download-${randomUUID()}.zip`);
  const uploadedFolders: Array<{ kind: BedrockPackKind; folder: string }> = [];
  let modifiedConfigs: PackConfig[] = [];

  try {
    await downloadToFile(fileUrl.toString(), archivePath);
    const bytes = await readFile(archivePath);
    const { packs, isAddon } = await prepareDownloadedArchive(bytes, filename);
    if (packs.length > 20) throw new BedrockAddonError('Arsip berisi terlalu banyak pack', 413);

    if (projectType === 'resourcepack' && packs.some((pack) => pack.manifest.kind !== 'resource')) {
      throw new BedrockAddonError('Project Resource Pack memiliki manifest behavior pack yang tidak sesuai', 400);
    }

    const existing = await listInstalledBedrockAddons(client, serverUuid);
    const existingIds = new Set(existing.addons.map((addon) => addon.pack_id.toLowerCase()));
    const newIds = new Set<string>();
    for (const pack of packs) {
      if (existingIds.has(pack.manifest.packId) || newIds.has(pack.manifest.packId)) {
        throw new BedrockAddonError(
          `Pack "${pack.manifest.name}" sudah terpasang. Hapus versi sebelumnya sebelum memasang ulang.`,
          409,
        );
      }
      newIds.add(pack.manifest.packId);
    }

    const worldDirectory = await resolveWorldPackDirectory(client, serverUuid);
    const configs = new Map<BedrockPackKind, PackConfig>();
    for (const kind of ['behavior', 'resource'] as const) {
      if (packs.some((pack) => pack.manifest.kind === kind)) {
        configs.set(kind, await readPackConfig(client, serverUuid, configPath(worldDirectory, configFilename(kind))));
      }
    }

    const directoryCache = new Set<string>();
    const totalExtracted = { bytes: 0 };
    for (const pack of packs) {
      const root = packRoot(pack.manifest.kind);
      const rootEntries = await listDirectoryOrMissing(client, serverUuid, root);
      if (rootEntries.some((entry) => entry.name === pack.folder)) {
        throw new BedrockAddonError(`Folder addon ${pack.folder} sudah ada di ${root}`, 409);
      }
      const destination = `${root}/${pack.folder}`;
      const createdDirectories = await ensureDirectory(client, serverUuid, destination, directoryCache);
      if (!createdDirectories.has(destination)) {
        throw new BedrockAddonError(`Folder addon ${pack.folder} sudah ada di ${root}`, 409);
      }
      uploadedFolders.push({ kind: pack.manifest.kind, folder: pack.folder });

      for (const file of pack.files) {
        const segments = file.relativePath.split('/');
        const filenameInPack = segments.pop();
        if (!filenameInPack || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
          throw new BedrockAddonError('Arsip berisi path file yang tidak aman', 400);
        }
        const parentDirectory = segments.length ? `${destination}/${segments.join('/')}` : destination;
        await ensureDirectory(client, serverUuid, parentDirectory, directoryCache);
        const outputPath = `${parentDirectory}/${filenameInPack}`;
        const stream = boundedEntryStream(file.entry, file.size, totalExtracted);
        await client.writeFileStream(serverUuid, outputPath, stream, file.size ?? undefined);
      }
    }

    for (const [kind, config] of Array.from(configs.entries())) {
      const additions = packs
        .filter((pack) => pack.manifest.kind === kind)
        .map((pack) => ({ pack_id: pack.manifest.packId, version: pack.manifest.version }));
      config.entries = [
        ...config.entries.filter((entry) => {
          const id = packIdFromConfigEntry(entry);
          return !id || !additions.some((addition) => addition.pack_id === id);
        }),
        ...additions,
      ];
      modifiedConfigs.push(config);
      await ensureDirectory(client, serverUuid, worldDirectory, directoryCache);
      await writePackConfig(client, serverUuid, config);
    }

    const first = packs[0].manifest;
    return {
      pack_id: first.packId,
      pack_name: first.name,
      type: isAddon ? 'addon' : first.kind,
      packs: packs.map((pack) => ({
        pack_id: pack.manifest.packId,
        pack_name: pack.manifest.name,
        type: pack.manifest.kind,
        version: pack.manifest.version.join('.'),
      })),
      requires_education_features: packs.some((pack) => pack.manifest.requiresEducationFeatures),
    };
  } catch (error) {
    // Roll back completed world-list writes and any partial pack directories on failure.
    for (const config of [...modifiedConfigs].reverse()) {
      try {
        await restorePackConfig(client, serverUuid, config);
      } catch {
        // Keep the original error; the route will report the partial failure context.
      }
    }
    try {
      await removePackFolders(client, serverUuid, uploadedFolders);
    } catch {
      // Best-effort cleanup; no downloaded data is retained on this panel host.
    }
    if (error instanceof BedrockAddonError) throw error;
    throw new BedrockAddonError(error instanceof Error ? error.message : 'Gagal memasang addon Bedrock', 502);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function deleteInstalledBedrockAddon(
  client: WingsClient,
  serverUuid: string,
  packIdValue: string,
): Promise<{ pack_id: string; deleted_folders: number }> {
  const packId = normalizePackId(packIdValue);
  if (!packId) throw new BedrockAddonError('pack_id tidak valid', 400);

  const worldDirectory = await resolveWorldPackDirectory(client, serverUuid);
  const behaviorConfig = await readPackConfig(
    client,
    serverUuid,
    configPath(worldDirectory, 'world_behavior_packs.json'),
  );
  const resourceConfig = await readPackConfig(
    client,
    serverUuid,
    configPath(worldDirectory, 'world_resource_packs.json'),
  );
  const installed = await listInstalledBedrockAddons(client, serverUuid);
  const folders = installed.addons
    .filter((addon) => addon.pack_id.toLowerCase() === packId)
    .map((addon) => ({ kind: addon.type, folder: addon.folder }));
  const referenced = [behaviorConfig, resourceConfig].some((config) =>
    config.entries.some((entry) => packIdFromConfigEntry(entry) === packId),
  );
  if (folders.length === 0 && !referenced) throw new BedrockAddonError('Addon tidak ditemukan', 404);

  for (const config of [behaviorConfig, resourceConfig]) {
    config.entries = config.entries.filter((entry) => packIdFromConfigEntry(entry) !== packId);
  }

  const changedConfigs = [behaviorConfig, resourceConfig].filter((config) =>
    config.entries.length !== (config.originalText === null ? 0 : (() => {
      try {
        const parsed: unknown = JSON.parse(config.originalText.replace(/^\uFEFF/, ''));
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    })()),
  );

  const written: PackConfig[] = [];
  try {
    for (const config of changedConfigs) {
      await writePackConfig(client, serverUuid, config);
      written.push(config);
    }
    await removePackFolders(client, serverUuid, folders);
  } catch (error) {
    for (const config of [...written].reverse()) {
      try {
        await restorePackConfig(client, serverUuid, config);
      } catch {
        // Best-effort rollback of pack lists if Wings rejects a folder deletion.
      }
    }
    if (error instanceof BedrockAddonError) throw error;
    throw new BedrockAddonError(error instanceof Error ? error.message : 'Gagal menghapus addon', 502);
  }

  return { pack_id: packId, deleted_folders: folders.length };
}

export function bedrockAddonErrorResponse(error: unknown): Response {
  const status = error instanceof BedrockAddonError ? error.status : 502;
  const message = error instanceof Error ? error.message : 'Gagal memproses addon Bedrock';
  return Response.json({ error: message }, { status });
}

