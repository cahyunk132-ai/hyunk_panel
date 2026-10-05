import 'server-only';
import { cache } from 'react';
import type { UserRole } from '@/types';
import { getSupabaseServerClient, getSupabaseServiceClient } from '@/lib/supabase/server';

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  role: UserRole;
}

/**
 * Session user saat ini (memoized per-request oleh React cache()).
 * null bila belum login. Membaca auth users + tabel public.users untuk role.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  // Baca profil lewat service client supaya konsisten (RLS di public.users
  // hanya mengizinkan select baris sendiri — ini fallback aman).
  const service = getSupabaseServiceClient();
  const { data: profile } = await service
    .from('users')
    .select('id, username, email, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    // Trigger handle_new_user seharusnya sudah membuat baris; ini self-heal.
    const username =
      (user.user_metadata?.username as string | undefined) ??
      user.email?.split('@')[0] ??
      `user-${user.id.slice(0, 8)}`;
    const { data: inserted } = await service
      .from('users')
      .upsert({ id: user.id, username, email: user.email ?? null }, { onConflict: 'id' })
      .select('id, username, email, role')
      .single();
    if (!inserted) return null;
    return { id: inserted.id, email: inserted.email ?? '', username: inserted.username, role: inserted.role };
  }

  // Sinkronkan email bila berubah di auth.users.
  if (user.email && profile.email !== user.email) {
    await service.from('users').update({ email: user.email }).eq('id', user.id);
  }

  return {
    id: profile.id,
    email: user.email ?? profile.email ?? '',
    username: profile.username,
    role: profile.role as UserRole,
  };
});

export async function requireUser(): Promise<SessionUser | Response> {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Tidak terautentikasi' }, { status: 401 });
  }
  return user;
}

export async function requireAdmin(): Promise<SessionUser | Response> {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (user.role !== 'admin') {
    return Response.json({ error: 'Butuh akses admin' }, { status: 403 });
  }
  return user;
}
