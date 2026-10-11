import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';
import { isUuid } from '@/lib/utils/format';
import {
  MAX_ANNOUNCEMENT_CONTENT,
  MAX_ANNOUNCEMENT_TITLE,
  isAnnouncementType,
  normalizeExpiresAt,
} from '@/lib/announcements';
import type { AnnouncementRow } from '@/types';

export const runtime = 'nodejs';

const ADMIN_COLUMNS = 'id, title, content, type, is_active, created_by, created_at, expires_at';

function clientIp(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

function invalidId(id: string) {
  return !isUuid(id);
}

/**
 * PATCH /api/admin/announcements/{id} — edit pengumuman dan/atau toggle aktif
 * (Owner Panel & Admin).
 *
 * Body boleh berisi sebagian field saja:
 *   { title?, content?, type?, is_active?, expires_at? }
 * Kirim `expires_at: null` untuk menjadikan pengumuman permanen.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (invalidId(params.id)) {
    return Response.json({ error: 'ID pengumuman tidak valid' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    content?: unknown;
    type?: unknown;
    is_active?: unknown;
    expires_at?: unknown;
  } | null;

  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Body tidak valid' }, { status: 400 });
  }

  const patch: Partial<Pick<AnnouncementRow, 'title' | 'content' | 'type' | 'is_active' | 'expires_at'>> = {};

  if (body.title !== undefined) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return Response.json({ error: 'Judul tidak boleh kosong' }, { status: 400 });
    if (title.length > MAX_ANNOUNCEMENT_TITLE) {
      return Response.json(
        { error: `Judul maksimal ${MAX_ANNOUNCEMENT_TITLE} karakter` },
        { status: 400 },
      );
    }
    patch.title = title;
  }

  if (body.content !== undefined) {
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return Response.json({ error: 'Konten tidak boleh kosong' }, { status: 400 });
    if (content.length > MAX_ANNOUNCEMENT_CONTENT) {
      return Response.json(
        { error: `Konten maksimal ${MAX_ANNOUNCEMENT_CONTENT} karakter` },
        { status: 400 },
      );
    }
    patch.content = content;
  }

  if (body.type !== undefined) {
    if (!isAnnouncementType(body.type)) {
      return Response.json(
        { error: "Tipe tidak valid. Pilih salah satu: 'info', 'warning', 'danger', 'success'" },
        { status: 400 },
      );
    }
    patch.type = body.type;
  }

  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') {
      return Response.json({ error: 'is_active harus boolean' }, { status: 400 });
    }
    patch.is_active = body.is_active;
  }

  // `expires_at: null` (permanen) dibedakan dari "field tidak dikirim".
  if ('expires_at' in body) {
    const expires = normalizeExpiresAt(body.expires_at);
    if (!expires.ok) return Response.json({ error: expires.error }, { status: 400 });
    patch.expires_at = expires.value;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json(
      { error: 'Tidak ada field yang diubah. Kirim title/content/type/is_active/expires_at.' },
      { status: 400 },
    );
  }

  const service = getSupabaseServiceClient();
  const { data: updated, error } = await service
    .from('announcements')
    .update(patch)
    .eq('id', params.id)
    .select(ADMIN_COLUMNS)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!updated) return Response.json({ error: 'Pengumuman tidak ditemukan' }, { status: 404 });

  const row = updated as unknown as AnnouncementRow;
  await logActivity({
    userId: admin.id,
    action: 'admin:announcement-update',
    metadata: {
      announcement_id: row.id,
      title: row.title,
      changed: Object.keys(patch),
      is_active: row.is_active,
      expires_at: row.expires_at,
    },
    ip: clientIp(request),
  });

  return Response.json({
    ok: true,
    announcement: row,
    message:
      patch.is_active === undefined
        ? 'Pengumuman diperbarui'
        : patch.is_active
          ? 'Pengumuman diaktifkan'
          : 'Pengumuman dinonaktifkan',
  });
}

/** DELETE /api/admin/announcements/{id} — hapus pengumuman (Owner Panel & Admin). */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  if (invalidId(params.id)) {
    return Response.json({ error: 'ID pengumuman tidak valid' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data: removed, error } = await service
    .from('announcements')
    .delete()
    .eq('id', params.id)
    .select(ADMIN_COLUMNS)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!removed) return Response.json({ error: 'Pengumuman tidak ditemukan' }, { status: 404 });

  const row = removed as unknown as AnnouncementRow;
  await logActivity({
    userId: admin.id,
    action: 'admin:announcement-delete',
    metadata: { announcement_id: row.id, title: row.title, type: row.type },
    ip: clientIp(request),
  });

  return Response.json({ ok: true, message: `Pengumuman "${row.title}" dihapus` });
}
