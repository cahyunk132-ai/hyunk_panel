import 'server-only';

import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { sendNotification } from '@/lib/notifications';
import type { ServerRow } from '@/types';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';
import { WingsError } from '@/lib/wings/client';

interface DeletableServer {
  id: string;
  uuid: string;
  name: string;
  node_id: string;
  owner_id: string | null;
  is_suspended: boolean;
  suspended_at: string | null;
  delete_after_at: string;
}

export interface DeleteExpiredDataResult {
  deleted: number;
  skipped: number;
  failed: number;
  results: Array<Record<string, unknown>>;
}

function isWingsNotFound(error: unknown): boolean {
  return error instanceof WingsError && error.status === 404;
}

/**
 * Permanently remove servers after the seven-day suspension grace period.
 * Cloud backup files are deliberately not touched; only the panel/node server
 * data is removed. Each server is isolated so one failure cannot stop cleanup.
 */
export async function deleteExpiredData(now = new Date()): Promise<DeleteExpiredDataResult> {
  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('servers')
    .select('id, uuid, name, node_id, owner_id, is_suspended, suspended_at, delete_after_at')
    .eq('is_suspended', true)
    .lte('delete_after_at', now.toISOString())
    .order('delete_after_at', { ascending: true });

  if (error) throw new Error(`Gagal mengambil server untuk dihapus: ${error.message}`);

  const results: Array<Record<string, unknown>> = [];
  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  for (const raw of (data ?? []) as DeletableServer[]) {
    try {
      const server = raw as ServerRow;
      const resolved = await resolveServerWings(server);
      if (resolved instanceof Response) {
        throw new Error('Node untuk server yang akan dihapus tidak tersedia');
      }

      try {
        await resolved.client.destroyServer(server.uuid);
      } catch (destroyError) {
        // A previous manual cleanup may already have removed the Wings record.
        if (!isWingsNotFound(destroyError)) throw destroyError;
      }

      const cleanupSteps: Array<[string, PromiseLike<{ error?: { message: string } | null }>]> = [
        ['server_subdomains', service.from('server_subdomains').delete().eq('server_id', server.id)],
        ['server_users', service.from('server_users').delete().eq('server_id', server.id)],
        ['backup_schedules', service.from('backup_schedules').delete().eq('server_id', server.id)],
        // Allocations are panel-owned ports; release them for reuse instead of deleting the pool row.
        ['allocations', service.from('allocations').update({ assigned_to: null }).eq('assigned_to', server.id)],
      ];

      for (const [table, operation] of cleanupSteps) {
        const result = await operation;
        if (result.error) throw new Error(`Gagal membersihkan ${table}: ${result.error.message}`);
      }

      // `backups` / `backup_logs` have server foreign keys and are cleaned by
      // the database when the server row is deleted. Cloud files remain intact.
      const { error: serverError } = await service.from('servers').delete().eq('id', server.id).eq('is_suspended', true);
      if (serverError) throw new Error(`Gagal menghapus server dari panel: ${serverError.message}`);

      let notification: Record<string, unknown> = { sent: 0, skipped: true };
      if (server.owner_id) {
        try {
          const sent = await sendNotification(server.owner_id, 'server_deleted', {
            serverName: server.name,
            serverId: server.id,
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

      // The server FK on activity_logs is SET NULL, so retain the deleted
      // server identity in metadata rather than attaching a stale FK.
      await logActivity({
        action: 'server_deleted',
        metadata: {
          server_id: server.id,
          uuid: server.uuid,
          name: server.name,
          suspended_at: server.suspended_at,
          delete_after_at: server.delete_after_at,
          notification,
        },
      });

      deleted += 1;
      results.push({ server_id: server.id, name: server.name, status: 'deleted', notification });
    } catch (serverError) {
      failed += 1;
      results.push({
        server_id: raw.id,
        name: raw.name,
        status: 'failed',
        error: serverError instanceof Error ? serverError.message : 'Gagal menghapus server',
      });
    }
  }

  skipped += (data ?? []).length - deleted - failed;
  return { deleted, skipped, failed, results };
}
