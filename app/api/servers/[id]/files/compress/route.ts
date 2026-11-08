import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { resolveServerWings, logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/**
 * Terjemahkan error mentah Wings untuk decompress (lihat
 * wings/router/router_server_files.go → postServerDecompressFiles) menjadi
 * pesan yang bisa ditindaklanjuti user.
 */
function decompressErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  if (/does not understand|unknown archive|no match/i.test(raw)) {
    return 'Format arsip tidak dikenali Wings. Yang didukung: zip, tar/tar.gz/tar.bz2/tar.xz/tar.zst, 7z, dan rar.';
  }
  if (/in use by another process|text file busy/i.test(raw)) {
    return 'Arsip berisi file yang sedang dipakai proses server. Hentikan server dulu, lalu ekstrak lagi.';
  }
  if (/password|encrypt|decrypt/i.test(raw)) {
    return 'Arsip terenkripsi/password tidak bisa diekstrak Wings. Hapus password arsipnya lalu upload ulang.';
  }
  if (/no space left|not enough space|space available/i.test(raw)) {
    return 'Sisa disk server tidak cukup untuk mengekstrak arsip ini.';
  }
  return raw || 'Gagal mengekstrak arsip';
}

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
      try {
        await resolved.client.decompressFile(resolved.server.uuid, root, body.file);
      } catch (err) {
        return Response.json({ error: decompressErrorMessage(err) }, { status: 400 });
      }
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
