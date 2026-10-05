import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission, getEffectivePermissions } from '@/lib/auth/rbac';
import { resolveServerWings } from '@/lib/wings/resolve';
import { createWebsocketToken } from '@/lib/wings/jwt';
import { WS_TOKEN_TTL_SECONDS } from '@/lib/utils/constants';

export const runtime = 'nodejs';

/**
 * POST /api/servers/{id}/console/token
 *
 * Menerbitkan JWT sementara (max 5 menit) untuk WebSocket console.
 * Token Wings ASLI tidak pernah keluar dari server — JWT ditandatangani
 * dengan HS256 memakai token node sebagai secret (persis cara Pterodactyl
 * panel menandatangani token websocket).
 *
 * Response: { token, socket, expires_in }
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'console', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  // Permission di JWT dibatasi sesuai permission user di panel.
  const perms = await getEffectivePermissions(user, checked.server);
  const jwtPermissions = perms.includes('*') ? ['*'] : perms;

  let token: string;
  try {
    token = createWebsocketToken(
      {
        nodeSecret: resolved.client.token,
        serverUuid: checked.server.uuid,
        userUuid: user.id,
      },
      jwtPermissions,
      WS_TOKEN_TTL_SECONDS,
    );
  } catch (err) {
    return Response.json(
      { error: `Gagal membuat token console: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 500 },
    );
  }

  return Response.json({
    token,
    socket: resolved.client.websocketUrl(checked.server.uuid),
    expires_in: WS_TOKEN_TTL_SECONDS,
  });
}
