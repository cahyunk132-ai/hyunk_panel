import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings } from '@/lib/wings/resolve';
import { loadPlayerSummaries, playerDataErrorPayload } from '@/lib/minecraft/playerdata';

export const runtime = 'nodejs';

/**
 * GET /api/servers/{id}/players — daftar player server (tanpa plugin).
 *
 * Data dibaca langsung dari file server: usercache.json, server.properties,
 * banned-players.json, ops.json, whitelist.json, dan {world}/playerdata/*.dat.
 * Inventory tidak ikut dikirim di daftar (payload besar) — lihat endpoint detail.
 *
 * Melihat daftar player = permission `console` (monitoring server),
 * sedangkan aksi kick/ban/op = `console.send` (lihat route [uuid]).
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'console', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  try {
    const { players, total } = await loadPlayerSummaries(resolved.client, resolved.server.uuid);
    return Response.json({ players, total });
  } catch (err) {
    return Response.json(playerDataErrorPayload(err), { status: 502 });
  }
}
