import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** POST /api/servers/{id}/files/compress — { root, files: [] } | { root, file, action: 'decompress' } */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const body = (await request.json().catch(() => null)) as {
    root?: string;
    files?: string[];
    file?: string;
    action?: 'compress' | 'decompress';
  } | null;
  const root = body?.root ?? '/';

  try {
    if (body?.action === 'decompress') {
      if (!body.file) return Response.json({ error: 'Field file wajib untuk decompress' }, { status: 400 });
      await resolved.client.decompressFile(resolved.server.uuid, root, body.file);
      await logActivity({
        userId: user.id,
        serverId: resolved.server.id,
        action: 'file:decompress',
        metadata: { root, file: body.file },
      });
      return Response.json({ ok: true });
    }

    if (!body?.files || body.files.length === 0) {
      return Response.json({ error: 'Field wajib: files (array, min 1)' }, { status: 400 });
    }
    const result = await resolved.client.compressFiles(resolved.server.uuid, root, body.files);
    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'file:compress',
      metadata: { root, count: body.files.length, archive: result?.file ?? null },
    });
    return Response.json({ ok: true, archive: result?.file ?? null });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Operasi arsip gagal' },
      { status: 502 },
    );
  }
}
