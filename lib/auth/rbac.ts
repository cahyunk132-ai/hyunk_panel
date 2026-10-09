import 'server-only';
import type { ServerPermission, ServerRow, UserRole } from '@/types';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import type { SessionUser } from './session';
import { isPanelAdmin } from './roles';

const MODERATOR_PERMISSIONS: ServerPermission[] = [
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
  'backup.schedule',
  'players',
];

const USER_PERMISSIONS: ServerPermission[] = [
  ...MODERATOR_PERMISSIONS,
  'backups.delete',
];

const SUBUSER_PERMISSIONS: ServerPermission[] = [...MODERATOR_PERMISSIONS];

const MODERATOR_SERVER_ACTIONS = new Set([
  'server.read',
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
  'backup.schedule',
  'players',
]);

const ASSIGNED_SERVER_ACTIONS = new Set([
  'server.read',
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
  'assign_subuser',
]);

interface ServerAssignment {
  role: 'user' | 'subuser';
  permissions: string[];
}

/** Ambil server berdasar id internal ATAU uuid Wings (keduanya unik). */
export async function getServerByIdOrUuid(idOrUuid: string): Promise<ServerRow | null> {
  const service = getSupabaseServiceClient();
  const { data } = await service
    .from('servers')
    .select('*')
    .or(`id.eq.${idOrUuid},uuid.eq.${idOrUuid}`)
    .maybeSingle();
  return (data as ServerRow | null) ?? null;
}

async function getServerAssignment(userId: string, serverId: string): Promise<ServerAssignment | null> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('server_users')
    .select('role, permissions')
    .eq('server_id', serverId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;

  const role = data.role === 'user' ? 'user' : 'subuser';
  const permissions = Array.isArray(data.permissions)
    ? data.permissions.filter((permission): permission is string => typeof permission === 'string')
    : [];
  return { role, permissions };
}

function roleCanPerform(user: SessionUser, action: string): boolean {
  if (user.role === 'owner_panel') return true;
  if (user.role === 'admin') return action !== 'manage_admins';
  if (user.role === 'moderator') {
    return action === 'view_all_servers' || action === 'audit_log' || MODERATOR_SERVER_ACTIONS.has(action);
  }
  if (user.role === 'user') return ASSIGNED_SERVER_ACTIONS.has(action);
  if (user.role === 'subuser') return ASSIGNED_SERVER_ACTIONS.has(action) && action !== 'backups.delete' && action !== 'assign_subuser';
  return false;
}

/**
 * Checks a permission against the role hierarchy and, for user/subuser, the
 * server_users assignment. Owner Panel/Admin are global; moderators can operate
 * every server with their fixed permission set; user roles are assignment-bound.
 */
export async function hasPermission(
  user: SessionUser,
  action: string,
  serverId?: string,
): Promise<boolean> {
  if (!roleCanPerform(user, action)) return false;

  if (isPanelAdmin(user.role) || user.role === 'moderator') return true;
  if (!serverId) return false;

  const assignment = await getServerAssignment(user.id, serverId);
  if (!assignment) return false;

  // Any assignment lets a user open that server's overview, even if its
  // operator permissions were intentionally left empty.
  if (action === 'server.read') return true;

  const assignmentRole: UserRole =
    user.role === 'subuser' || assignment.role === 'subuser' ? 'subuser' : 'user';
  if (action === 'assign_subuser') {
    return user.role === 'user' && assignmentRole === 'user';
  }
  if (action === 'backups.delete' && assignmentRole !== 'user') return false;
  if (action === 'kill' || action === 'settings' || action === 'server.edit' || action === 'delete_server') {
    return false;
  }

  // A server_users row with role='user' grants the standard user capabilities;
  // granular selections are meaningful only for a subuser row.
  if (assignmentRole === 'user') return true;
  const effectivePermissions = getRoleAllowedPermissions(assignment.permissions, assignmentRole);
  return permissionsInclude(effectivePermissions, action);
}

function getRoleAllowedPermissions(
  assigned: string[],
  role: 'user' | 'subuser',
): string[] {
  const allowed = role === 'user' ? USER_PERMISSIONS : SUBUSER_PERMISSIONS;
  if (assigned.includes('*')) return [...allowed];
  return assigned.filter((permission) => allowed.includes(permission as ServerPermission));
}

/** Daftar permission efektif user terhadap satu server. */
export async function getEffectivePermissions(
  user: SessionUser,
  server: ServerRow,
): Promise<string[]> {
  if (isPanelAdmin(user.role)) return ['*'];
  if (user.role === 'moderator') return [...MODERATOR_PERMISSIONS];

  const assignment = await getServerAssignment(user.id, server.id);
  if (!assignment) return [];
  const assignmentRole: 'user' | 'subuser' =
    user.role === 'subuser' || assignment.role === 'subuser' ? 'subuser' : 'user';
  if (assignmentRole === 'user') return [...USER_PERMISSIONS];
  return getRoleAllowedPermissions(assignment.permissions, assignmentRole);
}

export function permissionsInclude(have: string[], needed: string): boolean {
  if (have.includes('*')) return true;
  if (have.includes(needed)) return true;

  // `files` is the legacy all-files grant. Console read/send remain separate.
  if ((needed === 'files.read' || needed === 'files.edit') && have.includes('files')) return true;
  if (needed === 'monitoring' && have.includes('console')) return true;
  if (needed === 'power' && have.includes('start')) return true;
  return false;
}

/**
 * Checks a permission for one server. Returns the resolved server on success,
 * otherwise a clear 403/404 response suitable for API routes.
 */
export async function checkPermission(
  user: SessionUser,
  action: string,
  serverIdOrUuid: string,
): Promise<{ server: ServerRow } | Response> {
  const server = await getServerByIdOrUuid(serverIdOrUuid);
  if (!server) {
    return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });
  }
  if (server.is_suspended && !isPanelAdmin(user.role)) {
    return Response.json({ error: 'Server sedang disuspend' }, { status: 403 });
  }

  if (!(await hasPermission(user, action, server.id))) {
    if (user.role === 'user' || user.role === 'subuser') {
      const assignment = await getServerAssignment(user.id, server.id);
      if (!assignment) {
        return Response.json({ error: 'Anda tidak memiliki akses ke server ini' }, { status: 403 });
      }
      return Response.json(
        { error: `Akses ditolak: permission "${action}" belum diberikan untuk server ini` },
        { status: 403 },
      );
    }
    return Response.json({ error: `Role ${user.role} tidak memiliki akses untuk aksi "${action}"` }, { status: 403 });
  }
  return { server };
}

/** Semantic alias used by routes that read better as an access guard. */
export async function requireServerAccess(
  user: SessionUser,
  serverIdOrUuid: string,
  action: string,
): Promise<{ server: ServerRow } | Response> {
  return checkPermission(user, action, serverIdOrUuid);
}
