import { NextRequest } from 'next/server';
import { authenticateWings } from '@/lib/remote/auth';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/**
 * POST /api/remote/backups/{backup} — wings melaporkan hasil backup.
 * Body mengikuti remote.BackupRequest:
 * { checksum, checksum_type, size, successful, parts? }
 */
export async function POST(request: NextRequest, { params }: { params: { backup: string } }) {
  const node = await authenticateWings(request);
  if (node instanceof Response) return node;

  const body = (await request.json().catch(() => ({}))) as {
    checksum?: string;
    checksum_type?: string;
    size?: number;
    successful?: boolean;
  };

  const service = getSupabaseServiceClient();
  const { data: backup } = await service
    .from('backups')
    .select('id, server_id, uuid')
    .eq('uuid', params.backup)
    .maybeSingle();
  if (!backup) {
    // Backup tidak terdaftar di panel (mungkin dibuat sebelum migrasi) — sukseskan saja.
    return new Response(null, { status: 204 });
  }

  await service
    .from('backups')
    .update({
      is_successful: body.successful ?? true,
      size_bytes: body.size ?? null,
      checksum: body.checksum ?? null,
    })
    .eq('id', backup.id);

  await logActivity({
    serverId: backup.server_id as string,
    action: body.successful === false ? 'backup:failed' : 'backup:completed',
    metadata: { backup_uuid: params.backup, size: body.size ?? null },
  });

  return new Response(null, { status: 204 });
}
