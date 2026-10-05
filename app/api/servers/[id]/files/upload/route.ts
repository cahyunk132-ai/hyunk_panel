import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings } from '@/lib/wings/resolve';
import { createUploadToken } from '@/lib/wings/jwt';

export const runtime = 'nodejs';

/**
 * POST /api/servers/{id}/files/upload — { directory } → URL upload signed.
 * Browser meng-upload file LANGSUNG ke Wings dengan URL ini
 * (melewati batas body 4.5 MB Vercel). Token node tidak pernah ke browser,
 * yang keluar hanya JWT satu-kali-pakai (scope file-upload).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const body = (await request.json().catch(() => ({}))) as { directory?: string };
  const directory = body.directory ?? '/';

  const token = createUploadToken({
    nodeSecret: resolved.client.token,
    serverUuid: resolved.server.uuid,
    userUuid: user.id,
  });

  return Response.json({ url: resolved.client.uploadFileUrl(token, directory), directory });
}
