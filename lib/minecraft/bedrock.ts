/**
 * Player Minecraft Bedrock Edition (BDS) — dibaca & ditulis langsung lewat
 * Wings File API (tanpa plugin, tanpa database panel).
 *
 * Sumber data (root folder server):
 * - `allowlist.json`   → daftar player yang boleh join + `ignoresPlayerLimit`
 *   ```json
 *   [{ "name": "PlayerName", "xuid": "123456789", "ignoresPlayerLimit": false }]
 *   ```
 * - `permissions.json` → level permission per xuid
 *   ```json
 *   [{ "permission": "operator", "xuid": "123456789" }]
 *   ```
 *
 * Bedrock TIDAK punya `usercache.json` / `playerdata` seperti Java Edition,
 * jadi nama player hanya tersedia di `allowlist.json` dan harus diinput manual
 * saat menambah player. XUID adalah angka panjang (ID Xbox Live) — satu-satunya
 * kunci yang dipakai kedua file.
 *
 * Prinsip penulisan file:
 * - Baca dulu, ubah di server-side, baru tulis balik — field/urutan yang tidak
 *   dikenal (ditulis versi BDS lain) tetap dipertahankan.
 * - File yang belum ada dianggap array kosong (server baru / allow-list belum
 *   pernah dipakai).
 * - File yang ada tapi BUKAN array JSON valid → error, supaya isinya tidak
 *   tertimpa tanpa sengaja.
 * - Operasi yang menyentuh dua file (tambah/hapus) menulis allowlist.json lebih
 *   dulu lalu permissions.json; bukan transaksi atomik — bila penulisan kedua
 *   gagal, error menyebut file mana yang bermasalah dan UI menampilkannya.
 */

import type { WingsClient } from '@/lib/wings/client';

// ─── Konstanta ──────────────────────────────────────────────────────────────

/** Path file allowlist relatif root server (dipakai Wings: `/allowlist.json`). */
export const BEDROCK_ALLOWLIST_FILE = '/allowlist.json';
/** Path file permission relatif root server. */
export const BEDROCK_PERMISSIONS_FILE = '/permissions.json';

/** Level permission yang dikenal BDS (permissions.json). */
export const BEDROCK_PERMISSIONS = ['operator', 'member', 'visitor'] as const;
export type BedrockPermission = (typeof BEDROCK_PERMISSIONS)[number];

/** Permission default bila player ada di allowlist tapi tidak di permissions.json. */
export const BEDROCK_DEFAULT_PERMISSION: BedrockPermission = 'member';

/**
 * XUID Xbox Live = bilangan bulat 64-bit. BDS menulisnya sebagai string angka;
 * dibatasi 20 digit supaya nilai aneh (mis. hasil kalkulasi) langsung ditolak.
 */
const XUID_RE = /^[0-9]{1,20}$/;

/**
 * Nama player Bedrock (gamertag). Lebih longgar dari Java (`[A-Za-z0-9_]`) karena
 * gamertag boleh memuat spasi & tanda baca — tapi karakter kontrol, kutip, dan
 * backslash ditolak supaya JSON file server tidak bisa dirusak.
 */
const BEDROCK_NAME_RE = /^[^\u0000-\u001f\u007f"'\\<>/&]{1,32}$/;

/**
 * Nama yang aman dijadikan target command console (`op <name>`). Command
 * dikirim satu baris per entri, jadi nama dengan spasi tidak bisa dikirim
 * dengan aman → perubahan file tetap tersimpan, command-nya dilewati.
 */
const COMMAND_SAFE_NAME_RE = /^[A-Za-z0-9_]{1,16}$/;

// ─── Tipe & error ───────────────────────────────────────────────────────────

/** Satu baris tabel player Bedrock — gabungan `allowlist.json` + `permissions.json`. */
export interface BedrockPlayer {
  xuid: string;
  /** Nama dari allowlist.json; null bila xuid hanya ada di permissions.json. */
  name: string | null;
  permission: BedrockPermission;
  ignoresPlayerLimit: boolean;
  /** Ada di allowlist.json (sumber nama & ignoresPlayerLimit). */
  inAllowlist: boolean;
  /** Ada entri eksplisit di permissions.json (bukan default `member`). */
  inPermissions: boolean;
}

export interface BedrockPlayersResult {
  players: BedrockPlayer[];
  /** Jumlah xuid unik dari kedua file. */
  total: number;
}

/** Hasil operasi tulis: player setelah perubahan + command console yang dikirim. */
export interface BedrockMutationResult {
  player: BedrockPlayer | null;
  /** Command yang perlu dikirim ke console (allowlist reload / op / deop). */
  commands: string[];
}

/**
 * Error domain Bedrock. `status` = HTTP status yang harus dibalas API route,
 * sehingga route tidak perlu menerjemahkan pesan lagi.
 */
export class BedrockError extends Error {
  readonly status: number;
  detail?: string;

  constructor(message: string, options?: { status?: number; detail?: string }) {
    super(message);
    this.name = 'BedrockError';
    this.status = options?.status ?? 400;
    this.detail = options?.detail;
  }
}

/** Bentuk payload error untuk API route Bedrock. */
export function bedrockErrorPayload(err: unknown): { error: string; detail?: string } {
  if (err instanceof BedrockError) {
    return { error: err.message, detail: err.detail };
  }
  return {
    error: 'Gagal berbicara dengan node (Wings)',
    detail: err instanceof Error ? err.message : undefined,
  };
}

/**
 * Response error siap kirim: `BedrockError` membawa status HTTP-nya sendiri
 * (400 input salah, 404 tidak ditemukan, 409 duplikat, 502 node bermasalah).
 */
export function bedrockErrorResponse(err: unknown): Response {
  return Response.json(bedrockErrorPayload(err), {
    status: err instanceof BedrockError ? err.status : 502,
  });
}

// ─── Validasi input ─────────────────────────────────────────────────────────

export function isValidXuid(xuid: unknown): xuid is string {
  return typeof xuid === 'string' && XUID_RE.test(xuid.trim());
}

export function isValidBedrockPlayerName(name: unknown): name is string {
  return typeof name === 'string' && BEDROCK_NAME_RE.test(name.trim());
}

export function isBedrockPermission(value: unknown): value is BedrockPermission {
  return typeof value === 'string' && (BEDROCK_PERMISSIONS as readonly string[]).includes(value);
}

// ─── Helper internal ────────────────────────────────────────────────────────

type RawEntry = Record<string, unknown>;

function isRecord(value: unknown): value is RawEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Status HTTP dari WingsError tanpa meng-import class-nya (modul ini juga
 * dipakai di jalur yang tidak ingin menarik `node:crypto`).
 */
function wingsStatus(err: unknown): number | null {
  if (isRecord(err) && typeof err.status === 'number') return err.status;
  return null;
}

function textOf(entry: RawEntry, key: string): string | null {
  const value = entry[key];
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** xuid entri (menerima string maupun angka), null bila tidak valid. */
function xuidOf(entry: RawEntry): string | null {
  const raw = entry.xuid ?? entry.XUID;
  const value =
    typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
  return XUID_RE.test(value) ? value : null;
}

/** Nilai xuid yang akan ditulis balik (pertahankan format asli bila berupa string). */
function writeXuid(entry: RawEntry, xuid: string): string {
  return typeof entry.xuid === 'string' ? entry.xuid : xuid;
}

/** Permission entri permissions.json; nilai tidak dikenal → default `member`. */
function permissionOf(entry: RawEntry): BedrockPermission {
  return isBedrockPermission(entry.permission) ? entry.permission : BEDROCK_DEFAULT_PERMISSION;
}

/**
 * Baca file JSON array dari node.
 * - File tidak ada (404) atau kosong → array kosong.
 * - JSON tidak valid / bukan array → BedrockError 502 (jangan ditimpa).
 */
async function readJsonArray(
  client: WingsClient,
  serverUuid: string,
  file: string,
): Promise<RawEntry[]> {
  let raw: string;
  try {
    raw = await client.getFileContents(serverUuid, file);
  } catch (err) {
    if (wingsStatus(err) === 404) return [];
    throw new BedrockError(`Gagal membaca ${file} dari node`, {
      status: 502,
      detail: err instanceof Error ? err.message : undefined,
    });
  }

  const text = raw.replace(/^\uFEFF/, '').trim();
  if (text.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BedrockError(
      `Isi ${file} bukan JSON valid — perbaiki dulu lewat tab Files sebelum mengelola player dari panel`,
      { status: 502 },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new BedrockError(`${file} harus berisi array JSON`, { status: 502 });
  }
  return parsed.filter(isRecord);
}

/** Tulis file JSON (format BDS: 2 spasi + newline di akhir baris). */
async function writeJsonArray(
  client: WingsClient,
  serverUuid: string,
  file: string,
  entries: RawEntry[],
): Promise<void> {
  try {
    await client.writeFile(serverUuid, file, `${JSON.stringify(entries, null, 2)}\n`);
  } catch (err) {
    throw new BedrockError(`Gagal menulis ${file} ke node`, {
      status: 502,
      detail: err instanceof Error ? err.message : undefined,
    });
  }
}

async function readBoth(
  client: WingsClient,
  serverUuid: string,
): Promise<{ allowlist: RawEntry[]; permissions: RawEntry[] }> {
  const [allowlist, permissions] = await Promise.all([
    readJsonArray(client, serverUuid, BEDROCK_ALLOWLIST_FILE),
    readJsonArray(client, serverUuid, BEDROCK_PERMISSIONS_FILE),
  ]);
  return { allowlist, permissions };
}

/** Sisipkan/perbarui entri permission untuk satu xuid. */
function upsertPermissionEntry(
  permissions: RawEntry[],
  xuid: string,
  permission: BedrockPermission,
): void {
  const index = permissions.findIndex((entry) => xuidOf(entry) === xuid);
  if (index >= 0) {
    permissions[index] = { ...permissions[index], permission, xuid: writeXuid(permissions[index], xuid) };
    return;
  }
  permissions.push({ permission, xuid });
}

/** Command `op`/`deop` untuk perubahan permission; [] bila tidak perlu / nama tidak aman. */
function permissionCommands(
  permission: BedrockPermission,
  name: string | null,
): string[] {
  if (!name || !COMMAND_SAFE_NAME_RE.test(name)) return [];
  return [permission === 'operator' ? `op ${name}` : `deop ${name}`];
}

// ─── Baca (GET) ─────────────────────────────────────────────────────────────

/**
 * Baca kedua file lalu gabungkan per xuid.
 * Player di allowlist tanpa entri permission → permission default (`member`).
 * Entri permissions.json tanpa allowlist tetap ditampilkan (name null) supaya
 * op yang tidak ada di allowlist bisa dihapus/diturunkan dari panel.
 */
export async function loadBedrockPlayers(
  client: WingsClient,
  serverUuid: string,
): Promise<BedrockPlayersResult> {
  const { allowlist, permissions } = await readBoth(client, serverUuid);

  const merged = new Map<string, BedrockPlayer>();

  for (const entry of allowlist) {
    const xuid = xuidOf(entry);
    if (!xuid) continue;
    merged.set(xuid, {
      xuid,
      name: textOf(entry, 'name'),
      permission: BEDROCK_DEFAULT_PERMISSION,
      ignoresPlayerLimit: entry.ignoresPlayerLimit === true,
      inAllowlist: true,
      inPermissions: false,
    });
  }

  for (const entry of permissions) {
    const xuid = xuidOf(entry);
    if (!xuid) continue;
    const existing = merged.get(xuid);
    if (existing) {
      existing.permission = permissionOf(entry);
      existing.inPermissions = true;
      continue;
    }
    merged.set(xuid, {
      xuid,
      name: null,
      permission: permissionOf(entry),
      ignoresPlayerLimit: false,
      inAllowlist: false,
      inPermissions: true,
    });
  }

  const players = Array.from(merged.values());
  return { players, total: players.length };
}

// ─── Tambah (POST) ──────────────────────────────────────────────────────────

export interface AddBedrockPlayerInput {
  name: string;
  xuid: string;
  permission?: BedrockPermission;
  ignoresPlayerLimit?: boolean;
}

/**
 * Tambah player baru:
 * 1. xuid belum ada di allowlist → tambahkan entri `{ name, xuid, ignoresPlayerLimit }`.
 *    Bila xuid hanya ada di permissions.json (mis. hasil `op`), entri allowlist
 *    dilengkapi supaya nama player tersimpan.
 * 2. Upsert `permissions.json` dengan permission yang dipilih.
 * 3. Tulis kedua file + kembalikan command console (`allowlist reload`, `op`).
 */
export async function addBedrockPlayer(
  client: WingsClient,
  serverUuid: string,
  input: AddBedrockPlayerInput,
): Promise<BedrockMutationResult> {
  const name = input.name.trim();
  const xuid = input.xuid.trim();
  if (!isValidBedrockPlayerName(name)) {
    throw new BedrockError('Nama player tidak valid (1–32 karakter, tanpa tanda kutip/backslash)');
  }
  if (!isValidXuid(xuid)) {
    throw new BedrockError('XUID harus berupa angka (ID Xbox Live)');
  }
  const permission = input.permission ?? BEDROCK_DEFAULT_PERMISSION;
  if (!isBedrockPermission(permission)) {
    throw new BedrockError(`Permission harus salah satu dari: ${BEDROCK_PERMISSIONS.join(', ')}`);
  }
  const ignoresPlayerLimit = input.ignoresPlayerLimit === true;

  const { allowlist, permissions } = await readBoth(client, serverUuid);

  if (allowlist.some((entry) => xuidOf(entry) === xuid)) {
    throw new BedrockError(`XUID ${xuid} sudah ada di allowlist.json`, { status: 409 });
  }

  // Bila xuid ini sudah punya entri permission (mis. hasil `op` di console),
  // permission lama dibandingkan dulu supaya perubahan level tetap terkirim
  // ke console (termasuk penurunan operator → member).
  const existingPermission = permissions.find((entry) => xuidOf(entry) === xuid);
  const previous = existingPermission ? permissionOf(existingPermission) : null;

  allowlist.push({ name, xuid, ignoresPlayerLimit });
  upsertPermissionEntry(permissions, xuid, permission);

  await writeJsonArray(client, serverUuid, BEDROCK_ALLOWLIST_FILE, allowlist);
  await writeJsonArray(client, serverUuid, BEDROCK_PERMISSIONS_FILE, permissions);

  // `op`/`deop` tidak perlu dikirim saat player baru berpermission member
  // (tidak ada status operator yang harus dicabut).
  const permissionChanged = previous === null ? permission === 'operator' : previous !== permission;

  return {
    player: {
      xuid,
      name,
      permission,
      ignoresPlayerLimit,
      inAllowlist: true,
      inPermissions: true,
    },
    commands: [
      'allowlist reload',
      ...(permissionChanged ? permissionCommands(permission, name) : []),
    ],
  };
}

// ─── Ubah (PUT) ─────────────────────────────────────────────────────────────

export interface UpdateBedrockPlayerInput {
  permission?: BedrockPermission;
  ignoresPlayerLimit?: boolean;
}

/**
 * Ubah permission (permissions.json) dan/atau `ignoresPlayerLimit`
 * (allowlist.json). File yang tidak berubah tidak ditulis ulang.
 */
export async function updateBedrockPlayer(
  client: WingsClient,
  serverUuid: string,
  xuid: string,
  input: UpdateBedrockPlayerInput,
): Promise<BedrockMutationResult> {
  if (!isValidXuid(xuid)) {
    throw new BedrockError('XUID player tidak valid');
  }
  const hasPermission = input.permission !== undefined;
  const hasIgnore = input.ignoresPlayerLimit !== undefined;
  if (!hasPermission && !hasIgnore) {
    throw new BedrockError('Tidak ada yang diubah — kirim `permission` dan/atau `ignoresPlayerLimit`');
  }
  if (hasPermission && !isBedrockPermission(input.permission)) {
    throw new BedrockError(`Permission harus salah satu dari: ${BEDROCK_PERMISSIONS.join(', ')}`);
  }

  const { allowlist, permissions } = await readBoth(client, serverUuid);
  const allowIndex = allowlist.findIndex((entry) => xuidOf(entry) === xuid);
  const permissionIndex = permissions.findIndex((entry) => xuidOf(entry) === xuid);
  if (allowIndex < 0 && permissionIndex < 0) {
    throw new BedrockError('Player tidak ditemukan di allowlist.json maupun permissions.json', {
      status: 404,
    });
  }

  const name = allowIndex >= 0 ? textOf(allowlist[allowIndex], 'name') : null;
  const commands: string[] = [];
  let allowlistChanged = false;
  let permissionsChanged = false;
  let permission = permissionIndex >= 0 ? permissionOf(permissions[permissionIndex]) : BEDROCK_DEFAULT_PERMISSION;

  if (hasIgnore) {
    if (allowIndex < 0) {
      throw new BedrockError(
        'Player ini belum ada di allowlist.json — tambahkan player lewat tombol “Tambah player” untuk mengatur Ignore Player Limit',
        { status: 404 },
      );
    }
    const next = input.ignoresPlayerLimit === true;
    if ((allowlist[allowIndex].ignoresPlayerLimit === true) !== next) {
      allowlist[allowIndex] = { ...allowlist[allowIndex], ignoresPlayerLimit: next };
      allowlistChanged = true;
    }
  }

  if (hasPermission) {
    const next = input.permission as BedrockPermission;
    if (next !== permission || permissionIndex < 0) {
      upsertPermissionEntry(permissions, xuid, next);
      permissionsChanged = true;
      // Bedrock hanya punya dua level efektif (operator vs bukan) lewat console.
      if (next !== permission) commands.push(...permissionCommands(next, name));
      permission = next;
    }
  }

  if (allowlistChanged) {
    await writeJsonArray(client, serverUuid, BEDROCK_ALLOWLIST_FILE, allowlist);
    commands.push('allowlist reload');
  }
  if (permissionsChanged) {
    await writeJsonArray(client, serverUuid, BEDROCK_PERMISSIONS_FILE, permissions);
  }

  const ignoresPlayerLimit =
    allowIndex >= 0 ? allowlist[allowIndex].ignoresPlayerLimit === true : false;

  return {
    player: {
      xuid,
      name,
      permission,
      ignoresPlayerLimit,
      inAllowlist: allowIndex >= 0,
      inPermissions: hasPermission ? true : permissionIndex >= 0,
    },
    commands,
  };
}

// ─── Hapus (DELETE) ─────────────────────────────────────────────────────────

export interface RemoveBedrockPlayerResult {
  removedFromAllowlist: boolean;
  removedFromPermissions: boolean;
  commands: string[];
}

/**
 * Hapus player dari KEDUA file sekaligus (allowlist + permissions).
 * Bedrock membaca ulang allowlist lewat command `allowlist reload`, jadi command
 * itu dikirim setelah file berubah.
 */
export async function removeBedrockPlayer(
  client: WingsClient,
  serverUuid: string,
  xuid: string,
): Promise<RemoveBedrockPlayerResult> {
  if (!isValidXuid(xuid)) {
    throw new BedrockError('XUID player tidak valid');
  }

  const { allowlist, permissions } = await readBoth(client, serverUuid);
  const nextAllowlist = allowlist.filter((entry) => xuidOf(entry) !== xuid);
  const nextPermissions = permissions.filter((entry) => xuidOf(entry) !== xuid);

  const removedFromAllowlist = nextAllowlist.length !== allowlist.length;
  const removedFromPermissions = nextPermissions.length !== permissions.length;
  if (!removedFromAllowlist && !removedFromPermissions) {
    throw new BedrockError('Player tidak ditemukan di allowlist.json maupun permissions.json', {
      status: 404,
    });
  }

  if (removedFromAllowlist) {
    await writeJsonArray(client, serverUuid, BEDROCK_ALLOWLIST_FILE, nextAllowlist);
  }
  if (removedFromPermissions) {
    await writeJsonArray(client, serverUuid, BEDROCK_PERMISSIONS_FILE, nextPermissions);
  }

  return {
    removedFromAllowlist,
    removedFromPermissions,
    commands: removedFromAllowlist ? ['allowlist reload'] : [],
  };
}

// ─── Sinkronisasi console ───────────────────────────────────────────────────

export interface BedrockConsoleSync {
  /** true = command benar-benar terkirim ke server yang sedang running. */
  synced: boolean;
  commands: string[];
}

/**
 * Kirim command ke console server (best-effort).
 *
 * File JSON BDS baru berlaku saat server start / `allowlist reload`, jadi bila
 * server sedang online kita kirim command terkait supaya perubahan langsung
 * efektif. Server offline atau Wings tidak merespons BUKAN error — perubahan
 * file tetap tersimpan dan dipakai saat server start berikutnya.
 */
export async function syncBedrockConsole(
  client: WingsClient,
  serverUuid: string,
  commands: string[],
): Promise<BedrockConsoleSync> {
  if (commands.length === 0) return { synced: false, commands: [] };
  try {
    const server = await client.getServer(serverUuid);
    if (server.state !== 'running') return { synced: false, commands: [] };
    await client.sendCommands(serverUuid, commands);
    return { synced: true, commands };
  } catch {
    return { synced: false, commands: [] };
  }
}
