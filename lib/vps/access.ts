import 'server-only';

import type { SessionUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { getSupabaseServiceClient } from '@/lib/supabase/server';

export interface VpsRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  /** AES-256-GCM encrypted credential. Never pass this to a client component. */
  credential: string;
  owner_id: string | null;
  created_at?: string;
}

export interface VpsListItem {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  owner_id: string | null;
  created_at?: string;
}

/** Global staff roles follow the same visibility rule as the existing server list. */
function canSeeAllVps(user: SessionUser): boolean {
  return isPanelAdmin(user.role) || user.role === 'moderator';
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
    .select('id, name, host, port, username, credential, owner_id, created_at')
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

/** List metadata only; credentials are never selected for a browser-facing page. */
export async function listVpsForUser(user: SessionUser): Promise<VpsListItem[]> {
  const service = getSupabaseServiceClient();
  let query = service
    .from('vps')
    .select('id, name, host, port, username, owner_id, created_at')
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
