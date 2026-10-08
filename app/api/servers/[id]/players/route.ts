import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings } from '@/lib/wings/resolve';
import {
  isBedrockServer,
  loadPlayerSummaries,
  playerDataErrorPayload,
} from '@/lib/minecraft/playerdata';

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
 *
 * Server Bedrock Edition (image debian / startup bedrock_server) tidak punya
 * playerdata yang bisa dibaca → response `{ supported: false, message }`
 * (status 200) supaya UI menampilkan pesan info, bukan error merah.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'players', params.id);
  if (checked instanceof Response) return checked;

  // Cek image/startup sebelum memproses playerdata (Bedrock → unsupported).
  if (isBedrockServer(checked.server)) {
    return Response.json({
      supported: false,
      message: 'Player data tidak tersedia untuk Bedrock Edition server.',
    });
  }

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  try {
    const { players, total } = await loadPlayerSummaries(resolved.client, resolved.server.uuid);
    return Response.json({ players, total });
  } catch (err) {
    return Response.json(playerDataErrorPayload(err), { status: 502 });
  }
}
