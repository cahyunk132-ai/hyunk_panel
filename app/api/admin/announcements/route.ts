import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';
import { deliverAnnouncementEmail } from '@/lib/announcement-email';
import {
  MAX_ANNOUNCEMENT_CONTENT,
  MAX_ANNOUNCEMENT_TITLE,
  isAnnouncementExpired,
  isAnnouncementType,
  normalizeExpiresAt,
} from '@/lib/announcements';
import type {
  AdminAnnouncementRow,
  AdminAnnouncementsResponse,
  AnnouncementRow,
} from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const ADMIN_COLUMNS =
  'id, title, content, type, is_active, send_email, email_sent, created_by, created_at, expires_at';

function clientIp(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

/** Lengkapi baris pengumuman dengan username pembuatnya (satu query untuk semua). */
async function withCreatorNames(rows: AnnouncementRow[]): Promise<AdminAnnouncementRow[]> {
  const creatorIds = Array.from(
    new Set(rows.map((row) => row.created_by).filter((id): id is string => !!id)),
  );
  const creators = new Map<string, string>();
  if (creatorIds.length > 0) {
    const service = getSupabaseServiceClient();
    const { data: users } = await service.from('users').select('id, username').in('id', creatorIds);
    for (const user of (users ?? []) as Array<{ id: string; username: string | null }>) {
      if (user.username) creators.set(user.id, user.username);
    }
  }
  return rows.map((row) => ({
    ...row,
    created_by_username: row.created_by ? (creators.get(row.created_by) ?? null) : null,
  }));
}

/**
 * GET /api/admin/announcements — semua pengumuman (aktif, nonaktif, dan yang
 * sudah kedaluwarsa) untuk tabel admin. Owner Panel & Admin saja.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('announcements')
    .select(ADMIN_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as AnnouncementRow[];
  const announcements = await withCreatorNames(rows);
  const active = announcements.filter(
    (row) => row.is_active && !isAnnouncementExpired(row.expires_at),
  ).length;

  return Response.json({
    announcements,
    total: announcements.length,
    active,
  } satisfies AdminAnnouncementsResponse);
}

/**
 * POST /api/admin/announcements — buat pengumuman baru (Owner Panel & Admin).
 * Body: { title, content, type?, expires_at?, send_email? }
 *   type        : 'info' (default) | 'warning' | 'danger' | 'success'
 *   expires_at  : ISO / 'YYYY-MM-DDTHH:mm' / null → permanen sampai dinonaktifkan
 *   send_email  : true (default) untuk broadcast ke user aktif yang terverifikasi
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    content?: unknown;
    type?: unknown;
    expires_at?: unknown;
    send_email?: unknown;
  } | null;

  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  const type = body?.type === undefined ? 'info' : body.type;
  const sendEmail = body?.send_email === undefined ? true : body.send_email;

  if (!title || !content) {
    return Response.json({ error: 'Field wajib: judul dan konten' }, { status: 400 });
  }
  if (title.length > MAX_ANNOUNCEMENT_TITLE) {
    return Response.json(
      { error: `Judul maksimal ${MAX_ANNOUNCEMENT_TITLE} karakter` },
      { status: 400 },
    );
  }
  if (content.length > MAX_ANNOUNCEMENT_CONTENT) {
    return Response.json(
      { error: `Konten maksimal ${MAX_ANNOUNCEMENT_CONTENT} karakter` },
      { status: 400 },
    );
  }
  if (!isAnnouncementType(type)) {
    return Response.json(
      { error: "Tipe tidak valid. Pilih salah satu: 'info', 'warning', 'danger', 'success'" },
      { status: 400 },
    );
  }
  if (typeof sendEmail !== 'boolean') {
    return Response.json({ error: 'send_email harus boolean' }, { status: 400 });
  }

  const expires = normalizeExpiresAt(body?.expires_at);
  if (!expires.ok) return Response.json({ error: expires.error }, { status: 400 });

  const service = getSupabaseServiceClient();
  const { data: created, error } = await service
    .from('announcements')
    .insert({
      title,
      content,
      type,
      is_active: true,
      send_email: sendEmail,
      email_sent: false,
      expires_at: expires.value,
      created_by: admin.id,
    })
    .select(ADMIN_COLUMNS)
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const row = created as unknown as AnnouncementRow;
  await logActivity({
    userId: admin.id,
    action: 'admin:announcement-create',
    metadata: {
      announcement_id: row.id,
      title: row.title,
      type: row.type,
      expires_at: row.expires_at,
    },
    ip: clientIp(request),
  });

  const delivery = await deliverAnnouncementEmail(row);
  const announcement: AdminAnnouncementRow = {
    ...row,
    email_sent: delivery.email_sent,
    created_by_username: admin.username,
  };

  return Response.json(
    {
      ok: true,
      announcement,
      email_delivery: delivery.result
        ? {
            sent: delivery.result.sent,
            failed: delivery.result.failed,
            skipped: delivery.result.skipped,
            cancelled: delivery.result.cancelled,
            email_sent: delivery.email_sent,
          }
        : null,
    },
    { status: 201 },
  );
}
