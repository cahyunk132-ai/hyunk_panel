import { posix as posixPath } from 'node:path';
import { canManageVps } from '@/lib/vps/access';
import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';
import { normalizeVpsPath, uploadVpsFile } from '@/lib/vps/ssh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/vps/{id}/files/upload — multipart fields: file, path */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  if (!canManageVps(access.user, access.vps)) {
    return Response.json({ error: 'Hanya pemilik VPS yang dapat mengupload file' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Form upload tidak valid' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'File wajib diupload' }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) {
    return Response.json({ error: 'Ukuran file maksimal 10 MB' }, { status: 413 });
  }

  const suppliedPath = form.get('path');
  const path = typeof suppliedPath === 'string' && suppliedPath.trim()
    ? suppliedPath
    : `/${posixPath.basename(file.name)}`;

  try {
    const destination = normalizeVpsPath(path);
    await uploadVpsFile(access.vps, destination, Buffer.from(await file.arrayBuffer()));
    return Response.json({ success: true, path: destination, name: file.name });
  } catch (error) {
    console.error('Failed to upload VPS file', {
      vpsId: access.vps.id,
      path,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError('Gagal mengupload file ke VPS');
  }
}
