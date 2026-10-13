import { getSessionUser } from '@/lib/auth/session';
import { decryptSecret } from '@/lib/storage/crypto';
import { getVpsForUser } from '@/lib/vps/access';
import {
  createTerminalToken,
  getTerminalWebSocketUrl,
  TERMINAL_TOKEN_TTL_SECONDS,
} from '@/lib/terminal/jwt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/vps/{id}/terminal-token
 *
 * The credential is decrypted only after the current user has been checked
 * against the VPS owner/assignment. It is embedded in the short-lived JWT and
 * is never returned as a separate API field.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  const vps = await getVpsForUser(params.id, user);
  if (!vps) {
    // Do not disclose whether an inaccessible id exists.
    return Response.json({ error: 'VPS tidak ditemukan atau Anda tidak memiliki akses' }, { status: 404 });
  }

  let password: string;
  try {
    password = decryptSecret(vps.credential);
  } catch (error) {
    console.error('Failed to decrypt VPS terminal credential', {
      vpsId: vps.id,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return Response.json({ error: 'Credential VPS tidak dapat digunakan' }, { status: 500 });
  }

  try {
    const token = createTerminalToken({
      host: vps.host,
      port: vps.port,
      username: vps.username,
      password,
      userId: user.id,
    });

    return Response.json({
      token,
      wsUrl: getTerminalWebSocketUrl(),
      expires_in: TERMINAL_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    console.error('Failed to create VPS terminal token', {
      vpsId: vps.id,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return Response.json({ error: 'Terminal service belum dikonfigurasi' }, { status: 500 });
  }
}
