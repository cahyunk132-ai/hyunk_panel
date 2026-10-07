import { requireUser } from '@/lib/auth/session';
import {
  checkPermission,
  getEffectivePermissions,
  permissionsInclude,
} from '@/lib/auth/rbac';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';
import { isBedrockServer } from '@/lib/minecraft/playerdata';
import {
  bedrockErrorResponse,
  isBedrockPermission,
  isValidXuid,
  removeBedrockPlayer,
  syncBedrockConsole,
  updateBedrockPlayer,
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
 * PUT /api/servers/{id}/bedrock/players/{xuid} — ubah permission dan/atau
 * `ignoresPlayerLimit`.
 *
 * Body: `{ permission?, ignoresPlayerLimit? }` (minimal satu).
 * - `permission`         → upsert entri di `permissions.json`
 * - `ignoresPlayerLimit` → ubah entri di `allowlist.json`
 *
 * Setelah menulis file, command dikirim ke console bila server running &
 * user punya `console.send`: `op`/`deop <name>` (perubahan permission) dan
 * `allowlist reload` (perubahan allowlist).
 *
 * Dipakai fitur auto-save di UI: dropdown permission & checkbox Ignore Player
 * Limit memanggil endpoint ini setiap kali nilainya berubah.
 */
export async function PUT(request: Request, { params }: { params: { id: string; xuid: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;

  const rejected = rejectNonBedrock(checked.server);
  if (rejected) return rejected;

  if (!isValidXuid(params.xuid)) {
    return Response.json({ error: 'XUID player tidak valid' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { permission?: unknown; ignoresPlayerLimit?: unknown }
    | null;
  if (!body) return Response.json({ error: 'Body JSON tidak valid' }, { status: 400 });

  if (body.permission !== undefined && !isBedrockPermission(body.permission)) {
    return Response.json(
      { error: 'Permission harus salah satu dari: operator, member, visitor' },
      { status: 400 },
    );
  }
  if (body.ignoresPlayerLimit !== undefined && typeof body.ignoresPlayerLimit !== 'boolean') {
    return Response.json(
      { error: 'ignoresPlayerLimit harus berupa boolean' },
      { status: 400 },
    );
  }
  if (body.permission === undefined && body.ignoresPlayerLimit === undefined) {
    return Response.json(
      { error: 'Tidak ada yang diubah — kirim `permission` dan/atau `ignoresPlayerLimit`' },
      { status: 400 },
    );
  }

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const permissions = await getEffectivePermissions(user, checked.server);
  const canSendCommand = permissionsInclude(permissions, 'console.send');

  try {
    const result = await updateBedrockPlayer(resolved.client, resolved.server.uuid, params.xuid, {
      permission: isBedrockPermission(body.permission) ? body.permission : undefined,
      ignoresPlayerLimit:
        typeof body.ignoresPlayerLimit === 'boolean' ? body.ignoresPlayerLimit : undefined,
    });

    const sync = canSendCommand
      ? await syncBedrockConsole(resolved.client, resolved.server.uuid, result.commands)
      : { synced: false };

    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'bedrock:player-update',
      metadata: {
        xuid: params.xuid,
        name: result.player?.name,
        permission: result.player?.permission,
        ignoresPlayerLimit: result.player?.ignoresPlayerLimit,
      },
    });

    return Response.json({
      ok: true,
      player: result.player,
      commands: result.commands,
      consoleSynced: sync.synced,
    });
  } catch (err) {
    return bedrockErrorResponse(err);
  }
}

/**
 * DELETE /api/servers/{id}/bedrock/players/{xuid} — hapus player dari
 * `allowlist.json` DAN `permissions.json`, lalu kirim `allowlist reload` bila
 * server sedang running. Konfirmasi dilakukan di UI sebelum memanggil endpoint.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; xuid: string } },
) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;

  const rejected = rejectNonBedrock(checked.server);
  if (rejected) return rejected;

  if (!isValidXuid(params.xuid)) {
    return Response.json({ error: 'XUID player tidak valid' }, { status: 400 });
  }

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const permissions = await getEffectivePermissions(user, checked.server);
  const canSendCommand = permissionsInclude(permissions, 'console.send');

  try {
    const result = await removeBedrockPlayer(resolved.client, resolved.server.uuid, params.xuid);

    const sync = canSendCommand
      ? await syncBedrockConsole(resolved.client, resolved.server.uuid, result.commands)
      : { synced: false };

    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'bedrock:player-remove',
      metadata: {
        xuid: params.xuid,
        removedFromAllowlist: result.removedFromAllowlist,
        removedFromPermissions: result.removedFromPermissions,
      },
    });

    return Response.json({
      ok: true,
      removedFromAllowlist: result.removedFromAllowlist,
      removedFromPermissions: result.removedFromPermissions,
      commands: result.commands,
      consoleSynced: sync.synced,
    });
  } catch (err) {
    return bedrockErrorResponse(err);
  }
}
