import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';
import {
  isValidPlayerName,
  loadPlayerDetail,
  playerDataErrorPayload,
  resolvePlayerName,
} from '@/lib/minecraft/playerdata';

export const runtime = 'nodejs';

const PLAYER_UUID_RE = /^[0-9a-fA-F-]{32,36}$/;

const ACTIONS = [
  'kick',
  'ban',
  'unban',
  'op',
  'deop',
  'whitelist-add',
  'whitelist-remove',
] as const;
type PlayerAction = (typeof ACTIONS)[number];

/** Batas panjang alasan ban/kick. */
const MAX_REASON_LENGTH = 200;

/**
 * Bersihkan alasan: buang karakter kontrol & baris baru supaya tidak bisa
 * menyuntik command tambahan (Wings menulis tiap command sebagai satu baris).
 */
function sanitizeReason(reason: unknown): string | null {
  if (typeof reason !== 'string') return null;
  const clean = reason.replace(/[\r\n\u0000-\u001f\u2028\u2029]+/g, ' ').trim();
  return clean.length > 0 ? clean.slice(0, MAX_REASON_LENGTH) : null;
}

/** Mapping aksi → command Minecraft yang dikirim lewat Wings `sendCommands`. */
function buildCommand(action: PlayerAction, name: string, reason: string | null): string {
  switch (action) {
    case 'kick':
      return `kick ${name} ${reason ?? 'Kicked by admin'}`;
    case 'ban':
      return `ban ${name} ${reason ?? 'Banned by admin'}`;
    case 'unban':
      return `pardon ${name}`;
    case 'op':
      return `op ${name}`;
    case 'deop':
      return `deop ${name}`;
    case 'whitelist-add':
      return `whitelist add ${name}`;
    case 'whitelist-remove':
      return `whitelist remove ${name}`;
  }
}

/**
 * GET /api/servers/{id}/players/{uuid} — detail satu player.
 * File `.dat` di-parse ulang agar health/posisi/inventory selalu terbaru.
 */
export async function GET(_request: Request, { params }: { params: { id: string; uuid: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'players', params.id);
  if (checked instanceof Response) return checked;

  if (!PLAYER_UUID_RE.test(params.uuid)) {
    return Response.json({ error: 'UUID player tidak valid' }, { status: 400 });
  }

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  try {
    const player = await loadPlayerDetail(resolved.client, resolved.server.uuid, params.uuid);
    if (!player) {
      return Response.json(
        { error: 'Playerdata untuk player ini tidak ditemukan' },
        { status: 404 },
      );
    }
    return Response.json({ player });
  } catch (err) {
    return Response.json(playerDataErrorPayload(err), { status: 502 });
  }
}

/**
 * POST /api/servers/{id}/players/{uuid} — aksi ke player.
 * Body: { action, reason?, name? } — `name` hanya hint opsional dari UI;
 * bila kosong, nama dicari di usercache/whitelist/ops/banned server.
 * Butuh permission `console.send` karena aksi dikirim sebagai command.
 */
export async function POST(request: Request, { params }: { params: { id: string; uuid: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'players', params.id);
  if (checked instanceof Response) return checked;

  if (!PLAYER_UUID_RE.test(params.uuid)) {
    return Response.json({ error: 'UUID player tidak valid' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: string; reason?: string; name?: string }
    | null;
  const action = body?.action;
  if (!action || !(ACTIONS as readonly string[]).includes(action)) {
    return Response.json(
      { error: `Aksi tidak dikenal. Pilihan: ${ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }
  const playerAction = action as PlayerAction;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const hint = typeof body?.name === 'string' ? body.name.trim() : '';
  let name = isValidPlayerName(hint) ? hint : null;
  if (!name) {
    try {
      const fromCache = await resolvePlayerName(resolved.client, resolved.server.uuid, params.uuid);
      if (fromCache && isValidPlayerName(fromCache)) name = fromCache;
    } catch {
      name = null; // file server tidak terbaca → biarkan null (dibalas 400 di bawah)
    }
  }
  if (!name) {
    return Response.json(
      { error: 'Nama player tidak diketahui — pastikan player pernah bergabung ke server ini' },
      { status: 400 },
    );
  }

  const command = buildCommand(playerAction, name, sanitizeReason(body?.reason));

  try {
    await resolved.client.sendCommands(resolved.server.uuid, [command]);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal mengirim command ke server' },
      { status: 502 },
    );
  }

  await logActivity({
    userId: user.id,
    serverId: resolved.server.id,
    action: `player:${playerAction}`,
    metadata: { playerName: name, playerUuid: params.uuid },
  });

  return Response.json({ ok: true, command });
}
