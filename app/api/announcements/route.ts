import { getSupabaseServiceClient, isSupabaseServerConfigured } from '@/lib/supabase/server';
import { filterLiveAnnouncements } from '@/lib/announcements';
import type { PublicAnnouncement, PublicAnnouncementsResponse } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Kolom yang aman dikirim ke browser (tanpa is_active / created_by). */
const PUBLIC_COLUMNS = 'id, title, content, type, created_at, expires_at';

/** Batas jumlah banner yang dikirim ke satu halaman. */
const MAX_BANNERS = 20;

/**
 * GET /api/announcements — semua pengumuman yang sedang tayang (PUBLIK, tanpa
 * auth; dibuka middleware). Dipakai komponen banner di dashboard/servers.
 *
 * "Tayang" = is_active = true DAN (expires_at null ATAU expires_at > sekarang).
 * Filter dilakukan dua lapis: query Postgres + `filterLiveAnnouncements` supaya
 * pengumuman yang baru saja kedaluwarsa tidak ikut terkirim.
 */
export async function GET() {
  // Banner harus selalu segar — jangan sampai CDN/browser menyimpan hasilnya.
  const headers = { 'Cache-Control': 'no-store, max-age=0' };

  if (!isSupabaseServerConfigured()) {
    return Response.json(
      { announcements: [], total: 0 } satisfies PublicAnnouncementsResponse,
      { headers },
    );
  }

  const now = new Date();
  const service = getSupabaseServiceClient();

  const { data, error } = await service
    .from('announcements')
    .select(PUBLIC_COLUMNS)
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
    .order('created_at', { ascending: false })
    .limit(MAX_BANNERS);

  if (error) {
    // Tabel belum di-migrate / query gagal: jangan sampai merusak halaman user.
    return Response.json(
      { announcements: [], total: 0 } satisfies PublicAnnouncementsResponse,
      { headers },
    );
  }

  const announcements = filterLiveAnnouncements(
    (data ?? []) as unknown as PublicAnnouncement[],
    now,
  );

  return Response.json(
    { announcements, total: announcements.length } satisfies PublicAnnouncementsResponse,
    { headers },
  );
}
