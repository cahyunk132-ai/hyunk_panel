import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';
import { MAX_EDITABLE_FILE_BYTES } from '@/lib/utils/constants';

export const runtime = 'nodejs';

/** GET /api/servers/{id}/files/contents?file= — baca isi file (batas 2 MB). */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.read', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const file = request.nextUrl.searchParams.get('file');
  if (!file) return Response.json({ error: 'Parameter file wajib' }, { status: 400 });

  try {
    const content = await resolved.client.getFileContents(resolved.server.uuid, file);
    if (Buffer.byteLength(content, 'utf8') > MAX_EDITABLE_FILE_BYTES) {
      return Response.json(
        { error: 'File lebih besar dari 2 MB — tidak dapat dibuka di editor' },
        { status: 413 },
      );
    }
    return Response.json({ file, content });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal membaca file' },
      { status: 502 },
    );
  }
}

/** POST /api/servers/{id}/files/contents — { file, content } tulis file. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const body = (await request.json().catch(() => null)) as
    | { file?: string; content?: string }
    | null;
  if (!body?.file || typeof body.content !== 'string') {
    return Response.json({ error: 'Field wajib: file, content' }, { status: 400 });
  }
  if (Buffer.byteLength(body.content, 'utf8') > MAX_EDITABLE_FILE_BYTES) {
    return Response.json({ error: 'Konten lebih besar dari 2 MB' }, { status: 413 });
  }

  try {
    await resolved.client.writeFile(resolved.server.uuid, body.file, body.content);
    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'file:write',
      metadata: { file: body.file },
    });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal menulis file' },
      { status: 502 },
    );
  }
}
