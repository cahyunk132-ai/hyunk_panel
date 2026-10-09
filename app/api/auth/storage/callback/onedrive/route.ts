import { NextRequest } from 'next/server';

/**
 * GET /api/auth/storage/callback/onedrive — placeholder.
 * OneDrive sengaja belum diaktifkan: UI di halaman Storage menonaktifkan tombolnya
 * sampai kredensial ONEDRIVE_CLIENT_ID / ONEDRIVE_CLIENT_SECRET tersedia.
 */
export async function GET(_request: NextRequest) {
  return Response.json(
    { error: 'OneDrive belum tersedia — coming soon. Hubungi admin panel.' },
    { status: 501 },
  );
}
