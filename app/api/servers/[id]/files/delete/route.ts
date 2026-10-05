import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** POST /api/servers/{id}/files/delete — { root, files: [] } */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const body = (await request.json().catch(() => null)) as
    | { root?: string; files?: string[] }
    | null;
  if (!body?.files || body.files.length === 0) {
    return Response.json({ error: 'Field wajib: files (array, min 1)' }, { status: 400 });
  }
  if (body.files.length > 100) {
    return Response.json({ error: 'Maksimal 100 file per request' }, { status: 400 });
  }
  for (const f of body.files) {
    if (!f || f === '.' || f === '..' || f.includes('..') || f.startsWith('/')) {
      return Response.json({ error: `Nama file tidak valid: "${f}"` }, { status: 400 });
    }
  }

  try {
    await resolved.client.deleteFiles(resolved.server.uuid, body.root ?? '/', body.files);
    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'file:delete',
      metadata: { root: body.root ?? '/', count: body.files.length },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal menghapus file' },
      { status: 502 },
    );
  }
}
