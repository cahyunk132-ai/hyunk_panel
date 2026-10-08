import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

const SUBUSER_PERMISSION_GROUPS: Record<string, string[]> = {
  power: ['start', 'stop', 'restart'],
  console: ['console', 'console.send', 'monitoring'],
  files: ['files.read', 'files.edit'],
  backups: ['backups', 'backup.restore'],
  players: ['players'],
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** GET /api/servers/{id}/subusers — daftar subuser untuk server ini. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const access = await checkPermission(user, 'assign_subuser', params.id);
  if (access instanceof Response) return access;

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('server_users')
    .select('user_id, role, permissions, users(username, email)')
    .eq('server_id', access.server.id)
    .eq('role', 'subuser');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const subusers = (data ?? []).map((row) => {
    const profile = row.users as { username?: string; email?: string | null } | null;
    return {
      user_id: row.user_id as string,
      username: profile?.username ?? 'Unknown user',
      email: profile?.email ?? '',
      permissions: (row.permissions as string[] | null) ?? [],
    };
  });
  return Response.json({ subusers });
}

/**
 * POST /api/servers/{id}/subusers — assign akun yang ada atau kirim undangan
 * email jika akun belum terdaftar. Body permissions berisi nama grup UI.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const access = await checkPermission(user, 'assign_subuser', params.id);
  if (access instanceof Response) return access;

  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; permissions?: unknown }
    | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !isValidEmail(email)) {
    return Response.json({ error: 'Masukkan alamat email yang valid' }, { status: 400 });
  }

  const groups = Array.isArray(body?.permissions)
    ? body.permissions.filter((permission): permission is string => typeof permission === 'string')
    : [];
  const unknownGroup = groups.find((group) => !Object.prototype.hasOwnProperty.call(SUBUSER_PERMISSION_GROUPS, group));
  if (unknownGroup) {
    return Response.json({ error: `Permission subuser tidak dikenal: ${unknownGroup}` }, { status: 400 });
  }
  if (groups.length === 0) {
    return Response.json({ error: 'Pilih minimal satu permission untuk subuser' }, { status: 400 });
  }

  const permissions = Array.from(new Set(groups.flatMap((group) => SUBUSER_PERMISSION_GROUPS[group])));
  const service = getSupabaseServiceClient();
  const { data: existingProfile, error: profileError } = await service
    .from('users')
    .select('id, username, email, role')
    .ilike('email', email)
    .maybeSingle();
  if (profileError) return Response.json({ error: profileError.message }, { status: 500 });

  let profile = existingProfile;
  if (!profile) {
    const username = email.split('@')[0].slice(0, 48) || 'subuser';
    const { data: invitation, error: invitationError } = await service.auth.admin.inviteUserByEmail(email, {
      data: { username },
    });
    if (invitationError || !invitation.user) {
      return Response.json(
        { error: invitationError?.message ?? 'Undangan subuser gagal dikirim' },
        { status: 400 },
      );
    }

    const { data: invitedProfile, error: invitedProfileError } = await service
      .from('users')
      .upsert(
        {
          id: invitation.user.id,
          username: `${username}-${invitation.user.id.slice(0, 4)}`,
          email,
          role: 'subuser',
        },
        { onConflict: 'id' },
      )
      .select('id, username, email, role')
      .single();
    if (invitedProfileError || !invitedProfile) {
      return Response.json(
        { error: invitedProfileError?.message ?? 'Profil akun undangan gagal dibuat' },
        { status: 500 },
      );
    }
    profile = invitedProfile;
  }

  if (profile.id === user.id) {
    return Response.json({ error: 'Akun Anda tidak bisa diundang sebagai subuser sendiri' }, { status: 400 });
  }
  if (profile.role === 'owner_panel' || profile.role === 'admin' || profile.role === 'moderator') {
    return Response.json({ error: 'Akun dengan role staff tidak dapat ditambahkan sebagai subuser' }, { status: 400 });
  }

  const { data: existingAssignment } = await service
    .from('server_users')
    .select('role')
    .eq('server_id', access.server.id)
    .eq('user_id', profile.id)
    .maybeSingle();
  if (existingAssignment?.role === 'user') {
    return Response.json({ error: 'User ini sudah menjadi pengelola server dan tidak dapat diubah menjadi subuser' }, { status: 409 });
  }

  const { error: assignError } = await service.from('server_users').upsert(
    {
      server_id: access.server.id,
      user_id: profile.id,
      role: 'subuser',
      permissions,
    },
    { onConflict: 'server_id,user_id' },
  );
  if (assignError) return Response.json({ error: assignError.message }, { status: 500 });

  await logActivity({
    userId: user.id,
    serverId: access.server.id,
    action: 'server:subuser-assign',
    metadata: { email, permissions },
  });

  return Response.json(
    {
      subuser: {
        user_id: profile.id,
        username: profile.username,
        email: profile.email,
        permissions,
      },
      invited: !existingProfile,
    },
    { status: existingProfile ? 200 : 201 },
  );
}
