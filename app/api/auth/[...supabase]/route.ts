import { NextRequest } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Catch-all auth handler.
 * POST /api/auth/signout → hapus session
 * GET  /api/auth/session → info session saat ini
 */
export async function POST(request: NextRequest, { params }: { params: { supabase: string[] } }) {
  const action = params.supabase?.[0];
  if (action === 'signout') {
    const supabase = getSupabaseServerClient();
    await supabase.auth.signOut();
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'Auth action tidak dikenal' }, { status: 404 });
}

export async function GET(request: NextRequest, { params }: { params: { supabase: string[] } }) {
  const action = params.supabase?.[0];
  if (action === 'session') {
    const supabase = getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ user: null }, { status: 401 });
    return Response.json({ user: { id: user.id, email: user.email } });
  }
  return Response.json({ error: 'Auth action tidak dikenal' }, { status: 404 });
}
