import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { getProviderFileUrl } from '@/lib/storage';
import type { BackupLogRow, StorageProviderRow } from '@/types';

export const runtime = 'nodejs';

/**
 * GET /api/servers/[id]/backup-logs — history auto backup server (maks 50 terbaru).
 * Lihat log = permission `backups` (sama dengan tab Backups).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'backups', params.id);
  if (checked instanceof Response) return checked;

  const service = getSupabaseServiceClient();
  const { data: logs, error } = await service
    .from('backup_logs')
    .select('*')
    .eq('server_id', checked.server.id)
    .order('started_at', { ascending: false })
    .limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (logs ?? []) as BackupLogRow[];

  // Nama provider untuk tiap log (boleh beda user; ambil seperlunya).
  const providerIds = Array.from(
    new Set(rows.map((l) => l.storage_provider_id).filter(Boolean) as string[]),
  );
  const providersById: Record<string, StorageProviderRow> = {};
  if (providerIds.length > 0) {
    const { data: providers } = await service
      .from('storage_providers')
      .select('*')
      .in('id', providerIds);
    for (const p of (providers ?? []) as StorageProviderRow[]) {
      providersById[p.id] = p;
    }
  }

  return Response.json({
    logs: rows.map((log) => {
      const provider = log.storage_provider_id ? providersById[log.storage_provider_id] : undefined;
      return {
        ...log,
        provider_name: provider?.name ?? null,
        provider_type: provider?.provider ?? null,
        download_url:
          log.status === 'done' && log.storage_file_id && provider
            ? getProviderFileUrl(provider, log.storage_file_id)
            : null,
      };
    }),
  });
}
