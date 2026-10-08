import type { UserRole } from '@/types';

export const USER_ROLES: readonly UserRole[] = [
  'owner_panel',
  'admin',
  'moderator',
  'user',
  'subuser',
];

/** A smaller number means a higher role in the panel hierarchy. */
export const ROLE_RANK: Record<UserRole, number> = {
  owner_panel: 0,
  admin: 1,
  moderator: 2,
  user: 3,
  subuser: 4,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner_panel: 'Owner Panel',
  admin: 'Admin',
  moderator: 'Moderator',
  user: 'User',
  subuser: 'Subuser',
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && USER_ROLES.includes(value as UserRole);
}

export function isPanelAdmin(role: UserRole): boolean {
  return role === 'owner_panel' || role === 'admin';
}

export function canAssignRole(actor: UserRole, target: UserRole): boolean {
  if (ROLE_RANK[target] < ROLE_RANK[actor]) return false;
  if ((target === 'owner_panel' || target === 'admin') && actor !== 'owner_panel') return false;
  return true;
}

export function assignableRoles(actor: UserRole): UserRole[] {
  return USER_ROLES.filter((role) => canAssignRole(actor, role));
}
