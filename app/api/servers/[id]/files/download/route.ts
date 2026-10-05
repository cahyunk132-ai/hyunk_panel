import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings } from '@/lib/wings/resolve';
import { createFileDownloadToken } from '@/lib/wings/jwt';

export const runtime = 'nodejs';

/**
 * GET /api/servers/{id}/files/download?file= — URL download signed satu-kali-pakai.
 * URL mengarah langsung ke Wings (JWT), bukan membawa token node.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.read', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const file = request.nextUrl.searchParams.get('file');
  if (!file || file.includes('..')) {
    return Response.json({ error: 'Parameter file tidak valid' }, { status: 400 });
  }

  const token = createFileDownloadToken(
    { nodeSecret: resolved.client.token, serverUuid: resolved.server.uuid, userUuid: user.id },
    file.replace(/^\/+/, ''),
  );

  return Response.json({ url: resolved.client.downloadFileUrl(token) });
}
