import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

const VALID_PERMISSIONS = new Set([
  'start',
  'stop',
  'restart',
  'console',
  'console.send',
  'files',
  'files.read',
  'files.edit',
  'backups',
  'backup.restore',
  'players',
  'monitoring',
]);

const DEFAULT_USER_PERMISSIONS = [
  'start',
  'stop',
  'restart',
  'console',
  'console.send',
  'monitoring',
  'files.read',
  'files.edit',
  'backups',
  'backup.restore',
  'backups.delete',
  'players',
];

/** POST /api/admin/users/{id}/servers — assign user ke server. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as {
    server_id?: string;
    permissions?: unknown;
  } | null;
  if (!body?.server_id) {
    return Response.json({ error: 'Field wajib: server_id' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const [{ data: target }, { data: server }] = await Promise.all([
    service.from('users').select('id, role').eq('id', params.id).maybeSingle(),
    service.from('servers').select('id, name').eq('id', body.server_id).maybeSingle(),
  ]);
  if (!target) return Response.json({ error: 'User tidak ditemukan' }, { status: 404 });
  if (!server) return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });
  if (target.role !== 'user' && target.role !== 'subuser') {
    return Response.json({ error: 'Server hanya dapat di-assign ke role User atau Subuser' }, { status: 400 });
  }

  const assignmentRole = target.role === 'subuser' ? 'subuser' : 'user';
  const requested = assignmentRole === 'user'
    ? DEFAULT_USER_PERMISSIONS
    : Array.isArray(body.permissions)
      ? body.permissions.filter((permission): permission is string => typeof permission === 'string')
      : ['console'];
  const invalid = assignmentRole === 'subuser'
    ? requested.find((permission) => !VALID_PERMISSIONS.has(permission))
    : undefined;
  if (invalid) return Response.json({ error: `Permission subuser tidak dikenal: ${invalid}` }, { status: 400 });
  const permissions = Array.from(new Set(requested));

  const { error } = await service.from('server_users').upsert(
    {
      server_id: body.server_id,
      user_id: params.id,
      role: assignmentRole,
      permissions,
    },
    { onConflict: 'server_id,user_id' },
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: admin.id,
    serverId: body.server_id,
    action: 'admin:server-assign',
    metadata: { assigned_to: params.id, permissions, role: assignmentRole },
  });
  return Response.json({ ok: true }, { status: 201 });
}

/** DELETE /api/admin/users/{id}/servers — cabut akses. Body: { server_id } */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as { server_id?: string } | null;
  if (!body?.server_id) {
    return Response.json({ error: 'Field wajib: server_id' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { error } = await service
    .from('server_users')
    .delete()
    .eq('server_id', body.server_id)
    .eq('user_id', params.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: admin.id,
    serverId: body.server_id,
    action: 'admin:server-unassign',
    metadata: { removed_from: params.id },
  });
  return Response.json({ ok: true });
}
