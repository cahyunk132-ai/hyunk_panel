import 'server-only';

import type { SessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import type { VpsListItem } from '@/types';

export type { VpsListItem } from '@/types';

export interface VpsRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  /** AES-256-GCM encrypted credential. Never pass this to a client component. */
  credential: string;
  owner_id: string | null;
  is_backup_relay: boolean;
  created_at?: string;
}

/** Global staff roles follow the same visibility rule as the existing server list. */
function canSeeAllVps(user: SessionUser): boolean {
  return isPanelAdmin(user.role) || user.role === 'moderator';
}

export function toVpsListItem(vps: VpsRecord): VpsListItem {
  return {
    id: vps.id,
    name: vps.name,
    host: vps.host,
    port: vps.port,
    username: vps.username,
    owner_id: vps.owner_id,
    is_backup_relay: vps.is_backup_relay,
    created_at: vps.created_at,
  };
}

export function canManageVps(user: SessionUser, vps: VpsRecord): boolean {
  return isPanelAdmin(user.role) || vps.owner_id === user.id;
}

/**
 * Resolve one VPS and enforce access before a route can decrypt its credential.
 * The service-role client is used only after the panel session is available;
 * access is checked explicitly here because service role bypasses Supabase RLS.
 */
export async function getVpsForUser(id: string, user: SessionUser): Promise<VpsRecord | null> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('vps')
    .select('id, name, host, port, username, credential, owner_id, created_at, is_backup_relay')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;

  const vps = data as VpsRecord;
  if (canSeeAllVps(user) || vps.owner_id === user.id) return vps;

  const { data: assignment, error: assignmentError } = await service
    .from('vps_users')
    .select('vps_id')
    .eq('vps_id', vps.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (assignmentError || !assignment) return null;
  return vps;
}

/**
 * Find the preferred backup relay VPS.
 * Priority:
 * 1. VPS owned by ownerId with is_backup_relay = true
 * 2. Any VPS owned by ownerId
 * 3. Any system/global VPS with is_backup_relay = true (relay fallback for any server)
 */
export async function findBackupRelayVps(ownerId?: string | null): Promise<VpsRecord | null> {
  const service = getSupabaseServiceClient();

  if (ownerId) {
    // 1. VPS with is_backup_relay = true owned by ownerId
    const { data: preferred } = await service
      .from('vps')
      .select('id, name, host, port, username, credential, owner_id, created_at, is_backup_relay')
      .eq('owner_id', ownerId)
      .eq('is_backup_relay', true)
      .limit(1)
      .maybeSingle();
    if (preferred) return preferred as VpsRecord;

    // 2. Any VPS owned by ownerId
    const { data: anyOwned } = await service
      .from('vps')
      .select('id, name, host, port, username, credential, owner_id, created_at, is_backup_relay')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (anyOwned) return anyOwned as VpsRecord;
  }

  // 3. Fallback: Any VPS with is_backup_relay = true (e.g. system relay set up by admin)
  const { data: globalRelay } = await service
    .from('vps')
    .select('id, name, host, port, username, credential, owner_id, created_at, is_backup_relay')
    .eq('is_backup_relay', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (globalRelay) return globalRelay as VpsRecord;
  return null;
}

/** Backward-compatible alias for findBackupRelayVps. */
export const findOwnerVps = findBackupRelayVps;

/** List metadata only; credentials are never selected for a browser-facing page. */
export async function listVpsForUser(user: SessionUser): Promise<VpsListItem[]> {
  const service = getSupabaseServiceClient();
  let query = service
    .from('vps')
    .select('id, name, host, port, username, owner_id, created_at, is_backup_relay')
    .order('created_at', { ascending: true });

  if (!canSeeAllVps(user)) {
    const [{ data: owned }, { data: assigned }] = await Promise.all([
      service.from('vps').select('id').eq('owner_id', user.id),
      service.from('vps_users').select('vps_id').eq('user_id', user.id),
    ]);
    const ids = Array.from(
      new Set([
        ...(owned ?? []).map((row) => row.id as string),
        ...(assigned ?? []).map((row) => row.vps_id as string),
      ]),
    );
    query = ids.length > 0 ? query.in('id', ids) : query.limit(0);
  }

  const { data } = await query;
  return (data ?? []) as VpsListItem[];
}
