import { NextRequest } from 'next/server';
import { authenticateWings } from '@/lib/remote/auth';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { getEffectivePermissions, permissionsInclude } from '@/lib/auth/rbac';
import type { SessionUser } from '@/lib/auth/session';
import type { ServerRow } from '@/types';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

interface SftpAuthRequest {
  type: 'password' | 'public_key';
  username: string;
  password: string;
  ip?: string;
  session_id?: string;
  client_version?: string;
}

/**
 * POST /api/remote/sftp — validasi kredensial SFTP dari Wings.
 *
 * Format username: {username_panel}.{prefix-uuid-server}  (mis. "admin.45cf343c").
 * Password diverifikasi lewat Supabase Auth (sign-in ephemeral di server).
 * Response mengikuti remote.SftpAuthResponse: { server, user, permissions }.
 */
export async function POST(request: NextRequest) {
  const node = await authenticateWings(request);
  if (node instanceof Response) return node;

  const body = (await request.json().catch(() => null)) as SftpAuthRequest | null;
  if (!body?.username || body.type !== 'password' || !body.password) {
    return Response.json({ error: 'Kredensial tidak lengkap' }, { status: 400 });
  }

  const dot = body.username.lastIndexOf('.');
  if (dot <= 0) {
    return Response.json({ error: 'Format username harus {user}.{server-prefix}' }, { status: 400 });
  }
  const username = body.username.slice(0, dot);
  const serverPrefix = body.username.slice(dot + 1).toLowerCase();

  const service = getSupabaseServiceClient();
  const { data: server } = await service
    .from('servers')
    .select('*')
    .eq('node_id', node.id)
    .ilike('uuid', `${serverPrefix}%`)
    .maybeSingle();
  if (!server) {
    return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });
  }

  const { data: profile } = await service
    .from('users')
    .select('id, username, email, role')
    .eq('username', username)
    .maybeSingle();
  if (!profile?.email) {
    return Response.json({ error: 'User tidak ditemukan' }, { status: 403 });
  }

  // Verifikasi password via Supabase Auth (instance ephemeral, tanpa cookie).
  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: signInError } = await verifier.auth.signInWithPassword({
    email: profile.email,
    password: body.password,
  });
  if (signInError) {
    return Response.json({ error: 'Password salah' }, { status: 403 });
  }

  // Permission SFTP mengikuti hierarki role + assignment server_users.
  const sessionUser: SessionUser = {
    id: profile.id as string,
    username: profile.username as string,
    email: profile.email as string,
    role: profile.role as SessionUser['role'],
  };
  const panelPermissions = await getEffectivePermissions(sessionUser, server as ServerRow);
  let permissions: string[];
  if (permissionsInclude(panelPermissions, 'files.edit')) permissions = ['*'];
  else if (permissionsInclude(panelPermissions, 'files.read')) permissions = ['file.read', 'file.archive'];
  else return Response.json({ error: 'Tidak ada akses file untuk server ini' }, { status: 403 });

  return Response.json({
    server: server.uuid,
    user: profile.username,
    permissions,
  });
}
