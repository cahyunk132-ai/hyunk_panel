import 'server-only';

import { getSessionUser, type SessionUser } from '@/lib/auth/session';
import { getVpsForUser, type VpsRecord } from '@/lib/vps/access';

export interface AuthorizedVps {
  user: SessionUser;
  vps: VpsRecord;
}

/** Shared session + VPS access guard for VPS stats and file APIs. */
export async function requireVpsAccess(id: string): Promise<AuthorizedVps | Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });

  const vps = await getVpsForUser(id, user);
  if (!vps) {
    return Response.json({ error: 'VPS tidak ditemukan atau Anda tidak memiliki akses' }, { status: 404 });
  }
  return { user, vps };
}

export function isAuthorizedVps(value: AuthorizedVps | Response): value is AuthorizedVps {
  return !(value instanceof Response);
}

export function vpsOperationError(message = 'Operasi VPS gagal'): Response {
  return Response.json({ error: message }, { status: 502 });
}
