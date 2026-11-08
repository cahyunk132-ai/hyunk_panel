import { NextRequest } from 'next/server';
import { basename } from 'node:path';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings } from '@/lib/wings/resolve';
import { createUploadToken } from '@/lib/wings/jwt';
import { PROXY_UPLOAD_MAX_BYTES } from '@/lib/utils/constants';

export const runtime = 'nodejs';

/**
 * POST /api/servers/{id}/files/upload — { directory } → URL upload signed.
 *
 * Browser meng-upload file LANGSUNG ke Wings dengan URL ini (melewati batas
 * body 4.5 MB Vercel). Token node tidak pernah ke browser, yang keluar hanya
 * JWT satu-kali-pakai (scope file-upload).
 *
 * Supaya URL ini bisa dipakai, host node HARUS diizinkan di CSP `connect-src`
 * (lihat next.config.mjs → NEXT_PUBLIC_WINGS_ORIGINS) dan Wings harus mengirim
 * header CORS untuk origin panel (`api.allowed_origins` di config Wings).
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

  // `node` dipakai UI untuk pesan troubleshooting saat browser tidak bisa
  // menjangkau node (CSP/CORS).
  let nodeHost: string | undefined;
  try {
    nodeHost = new URL(resolved.client.publicUrl).host;
  } catch {
    nodeHost = undefined;
  }

  return Response.json({
    url: resolved.client.uploadFileUrl(token, directory),
    directory,
    node: nodeHost,
  });
}

/**
 * GET /api/servers/{id}/files/upload?directory=/&filename=foo.jar&size=12345
 * → `{ uploaded, size }`.
 *
 * Dipakai UI SESUDAH jalur langsung browser → Wings gagal di level jaringan.
 * Kegagalan itu sering HANYA soal header CORS (Wings tidak mengizinkan origin
 * panel), padahal file sudah terupload ke node. Daripada mengupload ulang
 * (dan gagal lagi untuk file > 4 MB), panel memverifikasi lewat Wings API
 * apakah file benar-benar sudah ada dengan ukuran yang sama.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const search = request.nextUrl.searchParams;
  const directory = search.get('directory') ?? '/';
  const filename = basename((search.get('filename') ?? '').trim());
  const expectedSize = Number(search.get('size') ?? '');
  if (!filename || filename === '.' || filename === '..' || /[\\/]/.test(filename)) {
    return Response.json({ error: 'Parameter filename tidak valid' }, { status: 400 });
  }

  try {
    const entries = await resolved.client.listFiles(resolved.server.uuid, directory);
    const found = entries.find((entry) => entry.name === filename && !entry.directory);
    const uploaded =
      Boolean(found) && (!Number.isFinite(expectedSize) || found!.size === expectedSize);
    return Response.json({ uploaded, size: found?.size ?? null });
  } catch (err) {
    // Verifikasi gagal (node tidak bisa dihubungi panel) → anggap belum terupload
    // supaya UI tetap mencoba jalur cadangan.
    return Response.json({
      uploaded: false,
      size: null,
      error: err instanceof Error ? err.message : 'Gagal memeriksa file di node',
    });
  }
}

/**
 * PUT /api/servers/{id}/files/upload?directory=/&filename=foo.jar — jalur
 * cadangan (fallback) bila browser TIDAK bisa menjangkau node secara langsung
 * (CSP host node belum diizinkan atau Wings tidak mengirim header CORS).
 *
 * Body request = isi file mentah (bukan multipart), lalu route ini membungkusnya
 * menjadi multipart dan men-stream ke Wings `/upload/file` tanpa menyimpan ke
 * disk. Catatan: di Vercel body function dibatasi ~4.5 MB — file lebih besar
 * tetap harus lewat jalur langsung (browser → Wings).
 */
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  const directory = request.nextUrl.searchParams.get('directory') ?? '/';
  const rawName = request.nextUrl.searchParams.get('filename') ?? '';
  const filename = basename(rawName.trim());
  if (!filename || filename === '.' || filename === '..' || /[\\/]/.test(filename)) {
    return Response.json({ error: 'Parameter filename tidak valid' }, { status: 400 });
  }
  if (!request.body) {
    return Response.json({ error: 'Body file kosong' }, { status: 400 });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > PROXY_UPLOAD_MAX_BYTES) {
    return Response.json(
      {
        error: `File lebih besar dari ${Math.floor(PROXY_UPLOAD_MAX_BYTES / (1024 * 1024))} MB tidak bisa diunggah lewat panel. Upload langsung ke node gagal — periksa CSP NEXT_PUBLIC_WINGS_ORIGINS dan CORS Wings (api.allowed_origins).`,
      },
      { status: 413 },
    );
  }

  try {
    await resolved.client.uploadFileStream(
      resolved.server.uuid,
      user.id,
      directory,
      filename,
      request.body as ReadableStream<Uint8Array>,
      Number.isFinite(declaredLength) ? declaredLength : undefined,
    );
    return Response.json({ success: true, name: filename, directory });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Gagal mengupload file ke node' },
      { status: 502 },
    );
  }
}
