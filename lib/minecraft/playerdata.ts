/**
 * Data player Minecraft Java Edition — TANPA plugin.
 *
 * Sumber data (dibaca langsung lewat Wings File API):
 * - `usercache.json`            → UUID → nama player (semua yang pernah join)
 * - `{world}/playerdata/*.dat`  → NBT binary per player (health, food, posisi, inventory, …)
 * - `banned-players.json`       → daftar ban
 * - `whitelist.json`            → daftar whitelist
 * - `ops.json`                  → daftar operator
 * - `server.properties`         → nilai `level-name` (folder world)
 *
 * Semua file JSON boleh tidak ada (server baru) → dianggap array kosong.
 * File lain yang tidak terbaca dilewati, bukan menggagalkan seluruh request.
 */

import { parseNbt, type NbtCompound, type NbtValue } from './nbt';
import type { WingsClient } from '@/lib/wings/client';
import type { WingsFileStat } from '@/lib/wings/types';

// ─── Tipe data ──────────────────────────────────────────────────────────────

export interface InventoryItem {
  slot: number;
  /** Contoh: "minecraft:diamond_sword" */
  id: string;
  count: number;
}

export interface PlayerData {
  uuid: string;
  /** Nama dari usercache.json (null bila tidak ada di cache). */
  name: string | null;
  health: number;
  foodLevel: number;
  /** 0 = survival, 1 = creative, 2 = adventure, 3 = spectator */
  gamemode: number;
  xpLevel: number;
  posX: number;
  posY: number;
  posZ: number;
  /** Contoh: "minecraft:overworld" */
  dimension: string;
  inventory: InventoryItem[];
  isBanned: boolean;
  isOp: boolean;
  isWhitelisted: boolean;
}

/** Data player tanpa inventory — dipakai untuk daftar (payload lebih kecil). */
export type PlayerSummary = Omit<PlayerData, 'inventory'>;

export interface PlayerFlags {
  isBanned: boolean;
  isOp: boolean;
  isWhitelisted: boolean;
}

export interface PlayerListResult {
  players: PlayerSummary[];
  /** Jumlah file playerdata yang ditemukan (bisa > players.length bila ada yang dilewati). */
  total: number;
}

// ─── Helper baca tag NBT ────────────────────────────────────────────────────

/** Nama tag playerdata — dipakai untuk menebak lokasi root compound. */
const PLAYER_ROOT_HINTS = [
  'Health',
  'foodLevel',
  'FoodLevel',
  'Inventory',
  'Pos',
  'playerGameType',
  'XpLevel',
  'Dimension',
];

/** Nama dimension versi lama (angka) sebelum 1.16. */
const LEGACY_DIMENSIONS: Record<string, string> = {
  '0': 'minecraft:overworld',
  '-1': 'minecraft:the_nether',
  '1': 'minecraft:the_end',
};

function isCompound(value: NbtValue | undefined): value is NbtCompound {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);
}

/**
 * Cari tag berdasarkan nama. Nama tag NBT case-sensitive, tetapi berbeda antar
 * versi Minecraft (mis. `FoodLevel` vs `foodLevel`, `Count` vs `count`), jadi
 * pencarian diulang secara case-insensitive.
 */
function findTag(compound: NbtCompound, ...names: string[]): NbtValue | undefined {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(compound, name)) return compound[name];
  }
  const lowered = names.map((name) => name.toLowerCase());
  for (const key of Object.keys(compound)) {
    if (lowered.includes(key.toLowerCase())) return compound[key];
  }
  return undefined;
}

function findCompound(compound: NbtCompound, ...names: string[]): NbtCompound | null {
  const value = findTag(compound, ...names);
  return isCompound(value) ? value : null;
}

function readNumber(compound: NbtCompound, fallback: number, ...names: string[]): number {
  const value = findTag(compound, ...names);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  return fallback;
}

function readNumberList(compound: NbtCompound, ...names: string[]): number[] {
  const value = findTag(compound, ...names);
  if (!Array.isArray(value)) return [];
  return value.map((entry) => (typeof entry === 'number' ? entry : typeof entry === 'bigint' ? Number(entry) : 0));
}

/** playerdata 1.16+ menaruh field langsung di root; sebagian file membungkusnya. */
function resolvePlayerRoot(nbt: NbtCompound): NbtCompound {
  if (PLAYER_ROOT_HINTS.some((key) => findTag(nbt, key) !== undefined)) return nbt;
  const data = findCompound(nbt, 'Data');
  if (data) {
    const player = findCompound(data, 'Player');
    if (player) return player;
    if (PLAYER_ROOT_HINTS.some((key) => findTag(data, key) !== undefined)) return data;
  }
  return findCompound(nbt, 'Player') ?? nbt;
}

function extractInventory(root: NbtCompound): InventoryItem[] {
  const list = findTag(root, 'Inventory');
  if (!Array.isArray(list)) return [];

  const items: InventoryItem[] = [];
  for (const entry of list) {
    if (!isCompound(entry)) continue;
    const slot = findTag(entry, 'Slot');
    const id = findTag(entry, 'id', 'Id');
    if (typeof slot !== 'number' || typeof id !== 'string' || id.length === 0) continue;
    if (id === 'minecraft:air' || id === 'air') continue;
    const rawCount = findTag(entry, 'count', 'Count');
    const count = typeof rawCount === 'number' ? rawCount : typeof rawCount === 'bigint' ? Number(rawCount) : 1;
    items.push({ slot, id, count: Math.max(1, Math.round(count)) });
  }
  return items.sort((a, b) => a.slot - b.slot);
}

function readDimension(root: NbtCompound): string {
  const value = findTag(root, 'Dimension');
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'bigint') return LEGACY_DIMENSIONS[value.toString()] ?? 'minecraft:overworld';
  if (typeof value === 'number') return LEGACY_DIMENSIONS[String(value)] ?? 'minecraft:overworld';
  return 'minecraft:overworld';
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Ubah NBT playerdata → objek PlayerData siap kirim ke UI.
 * Semua tag opsional: nilai default dipakai bila tag tidak ada.
 */
export function extractPlayerData(
  nbt: NbtCompound,
  uuid: string,
  name: string | null,
  flags: { isBanned: boolean; isOp: boolean; isWhitelisted: boolean },
): PlayerData {
  const root = resolvePlayerRoot(nbt);
  const pos = readNumberList(root, 'Pos');
  const gamemode = Math.round(readNumber(root, 0, 'playerGameType', 'PlayerGameType'));

  return {
    uuid,
    name,
    health: round2(Math.min(Math.max(readNumber(root, 20, 'Health'), 0), 1000)),
    foodLevel: Math.round(Math.min(Math.max(readNumber(root, 20, 'foodLevel', 'FoodLevel'), 0), 20)),
    gamemode: Number.isFinite(gamemode) ? gamemode : 0,
    xpLevel: Math.max(0, Math.round(readNumber(root, 0, 'XpLevel'))),
    posX: round2(pos[0] ?? 0),
    posY: round2(pos[1] ?? 0),
    posZ: round2(pos[2] ?? 0),
    dimension: readDimension(root),
    inventory: extractInventory(root),
    isBanned: flags.isBanned,
    isOp: flags.isOp,
    isWhitelisted: flags.isWhitelisted,
  };
}

/** Label gamemode untuk UI. */
export function gamemodeLabel(gm: number): string {
  switch (gm) {
    case 0:
      return 'Survival';
    case 1:
      return 'Creative';
    case 2:
      return 'Adventure';
    case 3:
      return 'Spectator';
    default:
      return 'Unknown';
  }
}

// ─── Pembacaan file server (dipakai API route /players) ─────────────────────

const DEFAULT_WORLD = 'world';
const MAX_PLAYER_FILES = 200; // batasi jumlah .dat yang dibaca agar request tidak menggantung
const READ_CONCURRENCY = 8;
const PLAYERDATA_FILE_RE = /^[0-9a-fA-F-]{32,36}\.dat$/;
const USERNAME_RE = /^[A-Za-z0-9_]{1,16}$/;

/** UUID dinormalisasi (tanpa dash, lowercase) untuk perbandingan antar file. */
function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase();
}

export function isValidPlayerName(name: string): boolean {
  return USERNAME_RE.test(name);
}

/** Playerdata tidak terbaca (Wings mati, world/playerdata tidak ada, dsb). */
export class PlayerDataUnavailableError extends Error {
  detail?: string;

  constructor(
    message = 'Server harus dalam keadaan online dan playerdata harus tersedia',
    detail?: string,
  ) {
    super(message);
    this.name = 'PlayerDataUnavailableError';
    this.detail = detail;
  }
}

/**
 * Bentuk payload error untuk API route `/players`: pesan ramah untuk UI +
 * detail teknis (opsional) supaya admin bisa melacak penyebabnya.
 */
export function playerDataErrorPayload(err: unknown): { error: string; detail?: string } {
  if (err instanceof PlayerDataUnavailableError) {
    return { error: err.message, detail: err.detail };
  }
  return {
    error: 'Server harus dalam keadaan online dan playerdata harus tersedia',
    detail: err instanceof Error ? err.message : undefined,
  };
}

/** Baca file teks kecil; null bila file tidak ada / tidak terbaca. */
async function readTextFile(
  client: WingsClient,
  serverUuid: string,
  file: string,
): Promise<string | null> {
  try {
    return await client.getFileContents(serverUuid, file);
  } catch {
    return null;
  }
}

/** Baca array JSON (usercache/banned-players/ops/whitelist); default []. */
async function readJsonArray(
  client: WingsClient,
  serverUuid: string,
  file: string,
): Promise<Record<string, unknown>[]> {
  const raw = await readTextFile(client, serverUuid, file);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object',
    );
  } catch {
    return [];
  }
}

function entryUuid(entry: Record<string, unknown>): string | null {
  const uuid = entry.uuid ?? entry.UUID;
  return typeof uuid === 'string' && uuid.length > 0 ? normalizeUuid(uuid) : null;
}

/** `server.properties` → map key/value (baris `#` dilewati). */
export function parseServerProperties(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    out[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return out;
}

/** Nama folder world dari `server.properties` (default "world"). */
export async function getWorldName(client: WingsClient, serverUuid: string): Promise<string> {
  const raw = await readTextFile(client, serverUuid, '/server.properties');
  if (!raw) return DEFAULT_WORLD;
  const levelName = parseServerProperties(raw)['level-name'];
  return levelName && levelName.length > 0 ? levelName : DEFAULT_WORLD;
}

interface ServerPlayerFiles {
  world: string;
  /** uuid ternormalisasi → nama player */
  names: Map<string, string>;
  banned: Set<string>;
  ops: Set<string>;
  whitelisted: Set<string>;
}

async function loadServerPlayerFiles(
  client: WingsClient,
  serverUuid: string,
): Promise<ServerPlayerFiles> {
  const [world, usercache, banned, ops, whitelist] = await Promise.all([
    getWorldName(client, serverUuid),
    readJsonArray(client, serverUuid, '/usercache.json'),
    readJsonArray(client, serverUuid, '/banned-players.json'),
    readJsonArray(client, serverUuid, '/ops.json'),
    readJsonArray(client, serverUuid, '/whitelist.json'),
  ]);

  const names = new Map<string, string>();
  // usercache = sumber utama; file lain hanya fallback nama.
  for (const list of [usercache, whitelist, ops, banned]) {
    for (const entry of list) {
      const uuid = entryUuid(entry);
      const name = typeof entry.name === 'string' ? entry.name : null;
      if (uuid && name && !names.has(uuid)) names.set(uuid, name);
    }
  }

  const toSet = (list: Record<string, unknown>[]): Set<string> => {
    const set = new Set<string>();
    for (const entry of list) {
      const uuid = entryUuid(entry);
      if (uuid) set.add(uuid);
    }
    return set;
  };

  return {
    world,
    names,
    banned: toSet(banned),
    ops: toSet(ops),
    whitelisted: toSet(whitelist),
  };
}

function flagsFor(files: ServerPlayerFiles, uuid: string): PlayerFlags {
  const key = normalizeUuid(uuid);
  return {
    isBanned: files.banned.has(key),
    isOp: files.ops.has(key),
    isWhitelisted: files.whitelisted.has(key),
  };
}

function toSummary(data: PlayerData): PlayerSummary {
  return {
    uuid: data.uuid,
    name: data.name,
    health: data.health,
    foodLevel: data.foodLevel,
    gamemode: data.gamemode,
    xpLevel: data.xpLevel,
    posX: data.posX,
    posY: data.posY,
    posZ: data.posZ,
    dimension: data.dimension,
    isBanned: data.isBanned,
    isOp: data.isOp,
    isWhitelisted: data.isWhitelisted,
  };
}

/** Jalankan `fn` untuk tiap item dengan batas paralel (jaga beban Wings). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Resolve direktori playerdata: MC 1.21+ menyimpan .dat di `/{world}/players`,
 * versi lama di `/{world}/playerdata`. Coba `players` dulu; kalau listing
 * berhasil (array returned) pakai path itu, kalau gagal/throw fallback ke
 * `playerdata`.
 */
async function resolvePlayerdataDir(
  client: WingsClient,
  serverUuid: string,
  world: string,
): Promise<string> {
  const modern = `/${world}/players`;
  try {
    const entries = await client.listFiles(serverUuid, modern);
    if (Array.isArray(entries)) return modern;
  } catch {
    // gagal → fallback ke path lama di bawah
  }
  return `/${world}/playerdata`;
}

/**
 * Daftar semua player yang punya playerdata di world aktif.
 * Melempar PlayerDataUnavailableError bila direktori playerdata tidak terbaca.
 */
export async function loadPlayerSummaries(
  client: WingsClient,
  serverUuid: string,
): Promise<PlayerListResult> {
  const files = await loadServerPlayerFiles(client, serverUuid);
  const directory = await resolvePlayerdataDir(client, serverUuid, files.world);

  let entries: WingsFileStat[];
  try {
    entries = await client.listFiles(serverUuid, directory);
  } catch (err) {
    throw new PlayerDataUnavailableError(
      undefined,
      err instanceof Error ? err.message : 'Gagal membaca direktori playerdata',
    );
  }

  const allFiles = entries
    .filter((entry) => !entry.directory && PLAYERDATA_FILE_RE.test(entry.name))
    .map((entry) => entry.name.replace(/\.dat$/i, ''));
  const uuids = allFiles.slice(0, MAX_PLAYER_FILES);

  const parsed = await mapLimit(uuids, READ_CONCURRENCY, async (uuid): Promise<PlayerSummary | null> => {
    try {
      const buffer = await client.getFileBinary(serverUuid, `${directory}/${uuid}.dat`);
      const data = extractPlayerData(
        parseNbt(buffer),
        uuid,
        files.names.get(normalizeUuid(uuid)) ?? null,
        flagsFor(files, uuid),
      );
      return toSummary(data);
    } catch {
      return null; // satu file rusak tidak boleh menggagalkan seluruh daftar
    }
  });

  const players = parsed.filter((entry): entry is PlayerSummary => entry !== null);
  if (allFiles.length > 0 && players.length === 0) {
    throw new PlayerDataUnavailableError(undefined, 'Semua file playerdata gagal dibaca');
  }
  return {
    players: players.sort((a, b) => (a.name ?? a.uuid).localeCompare(b.name ?? b.uuid, 'id')),
    total: allFiles.length,
  };
}

/**
 * Detail satu player (parse ulang file .dat-nya, termasuk inventory).
 * Mengembalikan null bila playerdata player tersebut tidak ada.
 */
export async function loadPlayerDetail(
  client: WingsClient,
  serverUuid: string,
  uuid: string,
): Promise<PlayerData | null> {
  if (!PLAYERDATA_FILE_RE.test(`${uuid}.dat`)) return null;

  const files = await loadServerPlayerFiles(client, serverUuid);
  const directory = await resolvePlayerdataDir(client, serverUuid, files.world);

  let entries: WingsFileStat[];
  try {
    entries = await client.listFiles(serverUuid, directory);
  } catch (err) {
    throw new PlayerDataUnavailableError(
      undefined,
      err instanceof Error ? err.message : 'Gagal membaca direktori playerdata',
    );
  }

  const expected = `${uuid}.dat`.toLowerCase();
  const key = normalizeUuid(uuid);
  // Nama file hanya diambil dari listing direktori — input user tidak pernah
  // dipakai langsung sebagai path.
  const fileName =
    entries.find((entry) => !entry.directory && entry.name.toLowerCase() === expected)?.name ??
    entries.find(
      (entry) =>
        !entry.directory &&
        PLAYERDATA_FILE_RE.test(entry.name) &&
        normalizeUuid(entry.name.replace(/\.dat$/i, '')) === key,
    )?.name;
  if (!fileName) return null;

  const canonicalUuid = fileName.replace(/\.dat$/i, '');
  try {
    const buffer = await client.getFileBinary(serverUuid, `${directory}/${fileName}`);
    return extractPlayerData(
      parseNbt(buffer),
      canonicalUuid,
      files.names.get(normalizeUuid(canonicalUuid)) ?? null,
      flagsFor(files, canonicalUuid),
    );
  } catch (err) {
    throw new PlayerDataUnavailableError(
      undefined,
      err instanceof Error ? err.message : `Gagal membaca playerdata ${canonicalUuid}`,
    );
  }
}

/**
 * Cari nama player (dari usercache/whitelist/ops/banned) — dipakai aksi
 * seperti kick/ban/op yang butuh nama, bukan UUID.
 */
export async function resolvePlayerName(
  client: WingsClient,
  serverUuid: string,
  uuid: string,
): Promise<string | null> {
  const files = await loadServerPlayerFiles(client, serverUuid);
  return files.names.get(normalizeUuid(uuid)) ?? null;
}
