import { requireUser } from '@/lib/auth/session';
import {
  checkPermission,
  getEffectivePermissions,
  permissionsInclude,
} from '@/lib/auth/rbac';
import {
  findPlayerDataFile,
  isValidPlayerName,
  resolvePlayerName,
} from '@/lib/minecraft/playerdata';
import {
  pingJavaServer,
  resolvePlayerOnlineState,
  type PlayerOnlineState,
} from '@/lib/minecraft/status';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';
import type { WingsClient } from '@/lib/wings/client';
import type { ServerRow } from '@/types';

export const runtime = 'nodejs';

const PLAYER_UUID_RE = /^[0-9a-fA-F-]{32,36}$/;
/** ID item: namespace:id, huruf kecil — cegah penyuntikan command. */
const ITEM_ID_RE = /^[a-z0-9_.-]+:[a-z0-9_/.-]+$/;
const MAX_GIVE_AMOUNT = 64;

const ACTIONS = ['clear', 'reset', 'teleport', 'give'] as const;
type PlayerAction = (typeof ACTIONS)[number];

interface ActionPayload {
  confirm?: unknown;
  x?: unknown;
  y?: unknown;
  z?: unknown;
  itemId?: unknown;
  amount?: unknown;
}

/** Jeda setelah kick agar server sempat menyimpan data player sebelum file dihapus. */
const KICK_SETTLE_MS = 1_500;

/** Koordinat: terima number atau string numerik; null bila tidak valid. */
function parseCoord(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Allocation utama server (ip:port yang dipakai Server List Ping). */
async function getPrimaryAllocation(
  server: ServerRow,
): Promise<{ ip: string; port: number } | null> {
  if (!server.allocation_id) return null;
  try {
    const service = getSupabaseServiceClient();
    const { data } = await service
      .from('allocations')
      .select('ip, port')
      .eq('id', server.allocation_id)
      .maybeSingle();
    if (!data || typeof data.ip !== 'string' || typeof data.port !== 'number') return null;
    return { ip: data.ip, port: data.port };
  } catch {
    return null;
  }
}

/**
 * Cek apakah player sedang online tanpa plugin:
 * 1. Server harus running (state dari Wings).
 * 2. Server List Ping ke allocation — nama player yang online ada di `players.sample`.
 */
async function checkPlayerOnline(
  server: ServerRow,
  client: WingsClient,
  playerName: string,
): Promise<{ state: PlayerOnlineState; serverRunning: boolean }> {
  let serverRunning = true;
  try {
    const detail = await client.getServer(server.uuid);
    serverRunning = detail.state === 'running';
  } catch {
    serverRunning = true; // state tidak terbaca → lanjut coba ping
  }
  if (!serverRunning) return { state: 'offline', serverRunning: false };

  const allocation = await getPrimaryAllocation(server);
  if (!allocation) return { state: 'unknown', serverRunning };

  const status = await pingJavaServer(allocation.ip, allocation.port);
  return { state: resolvePlayerOnlineState(status, playerName), serverRunning };
}

/**
 * POST /api/servers/{id}/players/{uuid}/action
 * Body: { action: 'clear'|'reset'|'teleport'|'give', payload?, name? }
 *
 * - clear   → command `clear {name}` (console.send, player online)
 * - reset   → kick bila online → hapus file playerdata {uuid}.dat (files.edit)
 * - teleport→ command `tp {name} {x} {y} {z}` (console.send, player online)
 * - give    → command `give {name} {item_id} {amount}` (console.send, player online)
 */
export async function POST(request: Request, { params }: { params: { id: string; uuid: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  if (!PLAYER_UUID_RE.test(params.uuid)) {
    return Response.json({ error: 'UUID player tidak valid' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: string; payload?: ActionPayload; name?: string }
    | null;
  const action = body?.action;
  if (!action || !(ACTIONS as readonly string[]).includes(action)) {
    return Response.json(
      { error: `Aksi tidak dikenal. Pilihan: ${ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }
  const playerAction = action as PlayerAction;
  const payload: ActionPayload = body?.payload ?? {};

  // Aksi berbasis command butuh console.send; reset (hapus file playerdata) butuh files.edit.
  const requiredPermission = playerAction === 'reset' ? 'files.edit' : 'console.send';
  const checked = await checkPermission(user, requiredPermission, params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;
  const { client, server } = resolved;

  // Nama player: hint opsional dari UI, fallback usercache/whitelist/ops/banned.
  const hint = typeof body?.name === 'string' ? body.name.trim() : '';
  let name = isValidPlayerName(hint) ? hint : null;
  if (!name) {
    try {
      const fromCache = await resolvePlayerName(client, server.uuid, params.uuid);
      if (fromCache && isValidPlayerName(fromCache)) name = fromCache;
    } catch {
      name = null;
    }
  }

  // ── Validasi payload per aksi ──────────────────────────────────────────────
  let teleport: { x: number; y: number; z: number } | null = null;
  let give: { itemId: string; amount: number } | null = null;

  if (playerAction === 'teleport') {
    const x = parseCoord(payload.x);
    const y = parseCoord(payload.y);
    const z = parseCoord(payload.z);
    if (x === null || y === null || z === null) {
      return Response.json(
        { error: 'Koordinat X, Y, Z wajib diisi angka yang valid' },
        { status: 400 },
      );
    }
    teleport = { x, y, z };
  }

  if (playerAction === 'give') {
    const itemId = typeof payload.itemId === 'string' ? payload.itemId.trim().toLowerCase() : '';
    if (!ITEM_ID_RE.test(itemId)) {
      return Response.json(
        { error: 'ID item tidak valid (contoh: minecraft:diamond)' },
        { status: 400 },
      );
    }
    const amount =
      typeof payload.amount === 'number' ? payload.amount : Number(payload.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_GIVE_AMOUNT) {
      return Response.json(
        { error: `Jumlah harus bilangan bulat 1–${MAX_GIVE_AMOUNT}` },
        { status: 400 },
      );
    }
    give = { itemId, amount };
  }

  if (playerAction === 'reset') {
    // Konfirmasi ganda: user harus mengetik nama player (atau UUID bila nama tidak diketahui).
    const confirm = typeof payload.confirm === 'string' ? payload.confirm.trim().toLowerCase() : '';
    const expected = (name ?? params.uuid).toLowerCase();
    if (!confirm || confirm !== expected) {
      return Response.json(
        { error: `Konfirmasi salah — ketik "${name ?? params.uuid}" untuk menghapus data player` },
        { status: 400 },
      );
    }
  }

  // clear/teleport/give menarget nama player; reset bekerja via UUID (boleh tanpa nama).
  if (playerAction !== 'reset' && !name) {
    return Response.json(
      { error: 'Nama player tidak diketahui — pastikan player pernah bergabung ke server ini' },
      { status: 400 },
    );
  }

  let warning: string | undefined;

  // ── clear/teleport/give: hanya efektif saat player online ──────────────────
  if (playerAction === 'clear' || playerAction === 'teleport' || playerAction === 'give') {
    const online = await checkPlayerOnline(server, client, name as string);
    if (online.state === 'offline') {
      return Response.json(
        {
          error: online.serverRunning
            ? `Player ${name} sedang offline — aksi "${playerAction}" hanya efektif saat player online`
            : `Server sedang offline — aksi "${playerAction}" hanya efektif saat player online`,
        },
        { status: 400 },
      );
    }
    if (online.state === 'unknown') {
      warning =
        'Status online player tidak dapat diverifikasi (server list ping gagal) — command tetap dikirim';
    }
  }

  // ── reset: kick dulu bila player online, baru hapus file playerdata ────────
  let kicked = false;
  let deletedFile: string | null = null;
  if (playerAction === 'reset') {
    const online = name
      ? await checkPlayerOnline(server, client, name)
      : { state: 'offline' as PlayerOnlineState, serverRunning: false };
    const perms = await getEffectivePermissions(user, server);
    const canSendCommand = permissionsInclude(perms, 'console.send');

    if (online.state !== 'offline' && name) {
      if (!canSendCommand) {
        if (online.state === 'online') {
          return Response.json(
            {
              error:
                'Player sedang online — butuh permission "console.send" untuk kick sebelum reset data',
            },
            { status: 403 },
          );
        }
        warning =
          'Status online player tidak dapat diverifikasi — jika player masih online, data bisa tersimpan ulang setelah reset';
      } else {
        // Player online → kick dulu supaya server menyimpan data sebelum file dihapus.
        try {
          await client.sendCommands(server.uuid, [`kick ${name} Reset data by admin`]);
          kicked = true;
          await new Promise((resolve) => setTimeout(resolve, KICK_SETTLE_MS));
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : 'Gagal mengirim kick ke server' },
            { status: 502 },
          );
        }
      }
    }

    const file = await findPlayerDataFile(client, server.uuid, params.uuid);
    if (!file) {
      return Response.json(
        { error: 'File playerdata tidak ditemukan — player belum pernah menyimpan data di world ini' },
        { status: 404 },
      );
    }
    try {
      await client.deleteFiles(server.uuid, file.directory, [file.fileName]);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Gagal menghapus file playerdata' },
        { status: 502 },
      );
    }
    deletedFile = `${file.directory}/${file.fileName}`;
  }

  // ── Kirim command ke console Wings ─────────────────────────────────────────
  let command: string | null = null;
  if (playerAction !== 'reset') {
    if (playerAction === 'clear') {
      command = `clear ${name}`;
    } else if (playerAction === 'teleport' && teleport) {
      command = `tp ${name} ${teleport.x} ${teleport.y} ${teleport.z}`;
    } else if (playerAction === 'give' && give) {
      command = `give ${name} ${give.itemId} ${give.amount}`;
    }
    if (!command) {
      return Response.json({ error: 'Gagal menyusun command' }, { status: 500 });
    }
    try {
      await client.sendCommands(server.uuid, [command]);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Gagal mengirim command ke server' },
        { status: 502 },
      );
    }
  }

  await logActivity({
    userId: user.id,
    serverId: server.id,
    action: `player:${playerAction}`,
    metadata: {
      playerName: name,
      playerUuid: params.uuid,
      ...(teleport ? { x: teleport.x, y: teleport.y, z: teleport.z } : {}),
      ...(give ? { itemId: give.itemId, amount: give.amount } : {}),
      ...(deletedFile ? { deletedFile, kicked } : {}),
    },
  });

  return Response.json({
    ok: true,
    action: playerAction,
    ...(command ? { command } : {}),
    ...(deletedFile ? { deleted: deletedFile, kicked } : {}),
    ...(warning ? { warning } : {}),
  });
}
