import { requireUser } from '@/lib/auth/session';
import {
  checkPermission,
  getEffectivePermissions,
  permissionsInclude,
} from '@/lib/auth/rbac';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';
import { isBedrockServer } from '@/lib/minecraft/playerdata';
import {
  addBedrockPlayer,
  bedrockErrorResponse,
  isBedrockPermission,
  loadBedrockPlayers,
  syncBedrockConsole,
} from '@/lib/minecraft/bedrock';
import type { ServerRow } from '@/types';

export const runtime = 'nodejs';

/** Endpoint ini hanya untuk server Bedrock (image `debian` / startup `bedrock_server`). */
function rejectNonBedrock(server: ServerRow): Response | null {
  if (isBedrockServer(server)) return null;
  return Response.json(
    { error: 'Endpoint ini hanya untuk server Bedrock Edition' },
    { status: 400 },
  );
}

/**
 * GET /api/servers/{id}/bedrock/players
 *
 * Baca `allowlist.json` + `permissions.json` lewat Wings File API lalu gabungkan
 * per xuid. Player di allowlist tanpa entri di permissions.json → `member`.
 *
 * Melihat daftar player = permission `console` (monitoring), sedangkan menambah/
 * mengubah/menghapus = `files.edit` (lihat method POST & route [xuid]).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'players', params.id);
  if (checked instanceof Response) return checked;

  const rejected = rejectNonBedrock(checked.server);
  if (rejected) return rejected;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  try {
    const result = await loadBedrockPlayers(resolved.client, resolved.server.uuid);
    return Response.json(result);
  } catch (err) {
    return bedrockErrorResponse(err);
  }
}

/**
 * POST /api/servers/{id}/bedrock/players — tambah player baru.
 *
 * Body: `{ name, xuid, permission?, ignoresPlayerLimit? }` (nama & xuid wajib).
 * Menulis `allowlist.json` DAN `permissions.json`, lalu (bila server running &
 * user punya `console.send`) mengirim `allowlist reload` + `op <name>`.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'players', params.id);
  if (checked instanceof Response) return checked;

  const rejected = rejectNonBedrock(checked.server);
  if (rejected) return rejected;

  const body = (await request.json().catch(() => null)) as
    | {
        name?: unknown;
        xuid?: unknown;
        permission?: unknown;
        ignoresPlayerLimit?: unknown;
      }
    | null;
  if (!body) return Response.json({ error: 'Body JSON tidak valid' }, { status: 400 });

  // Validasi detail (panjang nama, format xuid, daftar permission) ada di
  // lib/minecraft/bedrock.ts supaya aturannya satu tempat.
  if (body.permission !== undefined && !isBedrockPermission(body.permission)) {
    return Response.json(
      { error: 'Permission harus salah satu dari: operator, member, visitor' },
      { status: 400 },
    );
  }

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const permissions = await getEffectivePermissions(user, checked.server);
  const canSendCommand = permissionsInclude(permissions, 'console.send');

  try {
    const result = await addBedrockPlayer(resolved.client, resolved.server.uuid, {
      name: typeof body.name === 'string' ? body.name : '',
      xuid: typeof body.xuid === 'string' ? body.xuid : String(body.xuid ?? ''),
      permission: isBedrockPermission(body.permission) ? body.permission : undefined,
      ignoresPlayerLimit: body.ignoresPlayerLimit === true,
    });

    // Server offline / tanpa permission console → file tetap tersimpan, command
    // dilewati (best-effort) dan UI memberi tahu bahwa belum diterapkan.
    const sync = canSendCommand
      ? await syncBedrockConsole(resolved.client, resolved.server.uuid, result.commands)
      : { synced: false };

    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'bedrock:player-add',
      metadata: {
        name: result.player?.name,
        xuid: result.player?.xuid,
        permission: result.player?.permission,
        ignoresPlayerLimit: result.player?.ignoresPlayerLimit,
      },
    });

    return Response.json(
      { ok: true, player: result.player, commands: result.commands, consoleSynced: sync.synced },
      { status: 201 },
    );
  } catch (err) {
    return bedrockErrorResponse(err);
  }
}
