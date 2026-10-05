import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** GET /api/servers/{id}/files?directory=/ — list isi direktori. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.read', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const directory = request.nextUrl.searchParams.get('directory') ?? '/';
  try {
    const files = await resolved.client.listFiles(resolved.server.uuid, directory);
    return Response.json({ directory, files });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal membaca direktori' },
      { status: 502 },
    );
  }
}

/** POST /api/servers/{id}/files — { path, name } buat direktori baru. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const body = (await request.json().catch(() => null)) as { path?: string; name?: string } | null;
  if (!body?.name || !/^[A-Za-z0-9._ -]+$/.test(body.name)) {
    return Response.json({ error: 'Nama direktori tidak valid' }, { status: 400 });
  }
  try {
    await resolved.client.createDirectory(resolved.server.uuid, body.path ?? '/', body.name);
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal membuat direktori' },
      { status: 502 },
    );
  }
}
