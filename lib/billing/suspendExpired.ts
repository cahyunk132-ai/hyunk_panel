import 'server-only';

import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { sendNotification } from '@/lib/notifications';
import type { ServerRow } from '@/types';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';
import { WingsError } from '@/lib/wings/client';

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const REMINDER_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const REMINDER_DEDUPLICATION_MS = 24 * 60 * 60 * 1000;

interface BillingServer {
  id: string;
  uuid: string;
  name: string;
  node_id: string;
  owner_id: string | null;
  status: ServerRow['status'];
  is_suspended: boolean;
  expires_at: string;
}

export interface SuspendExpiredResult {
  suspended: number;
  reminders: number;
  skipped: number;
  failed: number;
  results: Array<Record<string, unknown>>;
}

function isWingsNotFound(error: unknown): boolean {
  return error instanceof WingsError && error.status === 404;
}

/**
 * Stop and suspend servers whose billing expiry has passed. A server is only
 * marked suspended after Wings accepted the stop request (or confirmed that
 * the server is already gone), so a temporary node outage is retried next day.
 */
export async function suspendExpired(now = new Date()): Promise<SuspendExpiredResult> {
  const service = getSupabaseServiceClient();
  const nowIso = now.toISOString();
  const { data, error } = await service
    .from('servers')
    .select('id, uuid, name, node_id, owner_id, status, is_suspended, expires_at')
    .lte('expires_at', nowIso)
    .eq('is_suspended', false)
    .not('expires_at', 'is', null)
    .order('expires_at', { ascending: true });

  if (error) throw new Error(`Gagal mengambil server expired: ${error.message}`);

  const results: Array<Record<string, unknown>> = [];
  let suspended = 0;
  let skipped = 0;
  let failed = 0;

  for (const raw of (data ?? []) as BillingServer[]) {
    try {
      const server = raw as ServerRow;
      const resolved = await resolveServerWings(server);
      if (resolved instanceof Response) {
        throw new Error('Node untuk server expired tidak tersedia');
      }

      try {
        await resolved.client.setPower(server.uuid, 'stop');
      } catch (stopError) {
        // Jika server sudah dihapus manual dari Wings, tetap amankan record panel.
        if (!isWingsNotFound(stopError)) throw stopError;
      }

      const suspendedAt = new Date(now.getTime());
      const deleteAfter = new Date(suspendedAt.getTime() + GRACE_PERIOD_MS);
      const { data: updated, error: updateError } = await service
        .from('servers')
        .update({
          is_suspended: true,
          suspended_at: suspendedAt.toISOString(),
          delete_after_at: deleteAfter.toISOString(),
          status: 'offline',
        })
        .eq('id', server.id)
        .eq('is_suspended', false)
        .select('id')
        .maybeSingle();

      if (updateError) throw new Error(`Gagal menyimpan status suspend: ${updateError.message}`);
      if (!updated) {
        skipped += 1;
        results.push({ server_id: server.id, name: server.name, status: 'already_handled' });
        continue;
      }

      let notification: Record<string, unknown> = { sent: 0, skipped: true };
      if (server.owner_id) {
        try {
          const sent = await sendNotification(server.owner_id, 'server_suspended', {
            serverName: server.name,
            serverId: server.id,
            expires_at: server.expires_at,
            time: suspendedAt,
          });
          notification = { sent: sent.sent, failed: sent.failed, skipped: sent.skipped };
        } catch (notificationError) {
          notification = {
            sent: 0,
            failed: 1,
            error: notificationError instanceof Error ? notificationError.message : 'Email gagal dikirim',
          };
        }
      }

      await logActivity({
        serverId: server.id,
        action: 'server_suspended',
        metadata: {
          name: server.name,
          uuid: server.uuid,
          expires_at: server.expires_at,
          suspended_at: suspendedAt.toISOString(),
          delete_after_at: deleteAfter.toISOString(),
          notification,
        },
      });

      suspended += 1;
      results.push({
        server_id: server.id,
        name: server.name,
        status: 'suspended',
        delete_after_at: deleteAfter.toISOString(),
        notification,
      });
    } catch (serverError) {
      failed += 1;
      results.push({
        server_id: raw.id,
        name: raw.name,
        status: 'failed',
        error: serverError instanceof Error ? serverError.message : 'Gagal suspend server',
      });
    }
  }

  const reminderUntil = new Date(now.getTime() + REMINDER_WINDOW_MS).toISOString();
  const reminderSince = new Date(now.getTime() - REMINDER_DEDUPLICATION_MS).toISOString();
  const { data: expiring, error: reminderQueryError } = await service
    .from('servers')
    .select('id, uuid, name, owner_id, expires_at')
    .eq('is_suspended', false)
    .gte('expires_at', nowIso)
    .lte('expires_at', reminderUntil)
    .order('expires_at', { ascending: true });

  if (reminderQueryError) {
    throw new Error(`Gagal mengambil server yang akan expired: ${reminderQueryError.message}`);
  }

  for (const server of (expiring ?? []) as Array<Pick<BillingServer, 'id' | 'uuid' | 'name' | 'owner_id' | 'expires_at'>>) {
    try {
      const { data: previous } = await service
        .from('activity_logs')
        .select('id')
        .eq('server_id', server.id)
        .eq('action', 'server_expiring_soon')
        .gte('created_at', reminderSince)
        .limit(1)
        .maybeSingle();

      if (previous) {
        skipped += 1;
        results.push({ server_id: server.id, name: server.name, status: 'reminder_already_sent' });
        continue;
      }

      let notification: Record<string, unknown> = { sent: 0, skipped: true };
      if (server.owner_id) {
        try {
          const sent = await sendNotification(server.owner_id, 'server_expiring_soon', {
            serverName: server.name,
            serverId: server.id,
            expires_at: server.expires_at,
            time: now,
          });
          notification = { sent: sent.sent, failed: sent.failed, skipped: sent.skipped };
        } catch (notificationError) {
          notification = {
            sent: 0,
            failed: 1,
            error: notificationError instanceof Error ? notificationError.message : 'Email gagal dikirim',
          };
        }
      }

      await logActivity({
        serverId: server.id,
        action: 'server_expiring_soon',
        metadata: { name: server.name, uuid: server.uuid, expires_at: server.expires_at, notification },
      });
      results.push({ server_id: server.id, name: server.name, status: 'reminder_sent', notification });
    } catch (serverError) {
      failed += 1;
      results.push({
        server_id: server.id,
        name: server.name,
        status: 'reminder_failed',
        error: serverError instanceof Error ? serverError.message : 'Gagal mengirim reminder',
      });
    }
  }

  return {
    suspended,
    reminders: results.filter((result) => result.status === 'reminder_sent').length,
    skipped,
    failed,
    results,
  };
}
