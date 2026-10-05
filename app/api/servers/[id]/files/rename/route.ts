import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** POST /api/servers/{id}/files/rename — { root, from, to } atau { root, files: [{from,to}] } */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const body = (await request.json().catch(() => null)) as {
    root?: string;
    from?: string;
    to?: string;
    files?: Array<{ from: string; to: string }>;
  } | null;

  const root = body?.root ?? '/';
  const files =
    body?.files && body.files.length > 0
      ? body.files
      : body?.from && body?.to
        ? [{ from: body.from, to: body.to }]
        : null;

  if (!files) {
    return Response.json({ error: 'Field wajib: from + to (atau files[])' }, { status: 400 });
  }
  for (const f of files) {
    if (!f.from || !f.to || f.from.includes('/') || f.to.includes('/')) {
      return Response.json(
        { error: 'Nama file tidak boleh kosong atau mengandung "/"' },
        { status: 400 },
      );
    }
  }

  try {
    await resolved.client.renameFile(resolved.server.uuid, root, files);
    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'file:rename',
      metadata: { root, files },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal rename file' },
      { status: 502 },
    );
  }
}
