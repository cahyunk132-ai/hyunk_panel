import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

interface MigrationRequest {
  sourceNodeId: string;
  targetNodeId: string;
}

interface MigrationResult {
  success: boolean;
  serversMoved: number;
  dnsRecordsUpdated: Array<{ recordId: string; name: string; newIp: string }>;
  error?: string;
}

/**
 * POST /api/admin/nodes/migrate
 * Migrasi server dari satu node ke node lain.
 * Akses: Owner Panel & Admin saja.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as MigrationRequest | null;
  if (!body || !body.sourceNodeId || !body.targetNodeId) {
    return Response.json({ error: 'Node sumber dan tujuan wajib diisi' }, { status: 400 });
  }

  const { sourceNodeId, targetNodeId } = body;

  // ── Step 1: Validasi ──────────────────────────────────────────────────────
  const service = getSupabaseServiceClient();

  const [{ data: sourceNode }, { data: targetNode }] = await Promise.all([
    service.from('nodes').select('*').eq('id', sourceNodeId).maybeSingle(),
    service.from('nodes').select('*').eq('id', targetNodeId).maybeSingle(),
  ]);

  const src = (sourceNode as import('@/types').NodeRow | null) ?? null;
  const tgt = (targetNode as import('@/types').NodeRow | null) ?? null;

  if (!src) {
    return Response.json({ error: 'Node sumber tidak ditemukan' }, { status: 404 });
  }
  if (!tgt) {
    return Response.json({ error: 'Node tujuan tidak ditemukan' }, { status: 404 });
  }
  if (sourceNodeId === targetNodeId) {
    return Response.json({ error: 'Node sumber dan tujuan harus berbeda' }, { status: 400 });
  }
  if (tgt.is_maintenance) {
    return Response.json(
      { error: 'Node tujuan sedang dalam maintenance, tidak dapat menerima migrasi' },
      { status: 400 },
    );
  }

  // ── Step 2: Pindah server di database ────────────────────────────────────
  const { data: servers, error: updateError } = await service
    .from('servers')
    .update({ node_id: targetNodeId })
    .eq('node_id', sourceNodeId)
    .select('id, name, uuid');

  if (updateError) {
    return Response.json(
      { error: `Gagal mengupdate database: ${updateError.message}` },
      { status: 500 },
    );
  }

  const movedServers = (servers ?? []) as Array<{ id: string; name: string; uuid: string }>;
  const serversMoved = movedServers.length;

  if (serversMoved === 0) {
    return Response.json({
      success: true,
      serversMoved: 0,
      dnsRecordsUpdated: [],
      error: null,
    });
  }

  // ── Step 3: Update DNS Cloudflare ─────────────────────────────────────────
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const cfZoneId = process.env.CLOUDFLARE_ZONE_ID;

  const dnsRecordsUpdated: Array<{ recordId: string; name: string; newIp: string }> = [];

  if (cfToken && cfZoneId && src.fqdn) {
    try {
      // Ambil semua DNS A records dari Cloudflare API
      const listUrl = `https://api.cloudflare.com/client/v4/zones/${cfZoneId}/dns_records?type=A`;
      const listRes = await fetch(listUrl, {
        headers: {
          Authorization: `Bearer ${cfToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!listRes.ok) {
        throw new Error(`Cloudflare API list error: ${listRes.status}`);
      }

      const listData = (await listRes.json()) as {
        success: boolean;
        result: Array<{ id: string; name: string; type: string; content: string }>;
      };

      if (!listData.success) {
        throw new Error('Cloudflare API returned unsuccessful response');
      }

      const allRecords = listData.result;

      // Filter records yang mengarah ke node sumber berdasarkan nama
      const hostname = src.fqdn.split('.')[0].toLowerCase();
      const recordsToUpdate = allRecords.filter((record) => {
        const recordName = record.name.toLowerCase();
        // Cocokkan: record name mengandung hostname node sumber
        // Misal: node2.wangstore.web.id → cari record yang mengandung "node2"
        return recordName.includes(hostname) || recordName === src.fqdn.toLowerCase();
      });

      // Update setiap record ke IP node tujuan
      for (const record of recordsToUpdate) {
        const recordId = record.id;
        const recordName = record.name;

        const cfUrl = `https://api.cloudflare.com/client/v4/zones/${cfZoneId}/dns_records/${recordId}`;
        const cfRes = await fetch(cfUrl, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${cfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: tgt.fqdn }),
        });

        if (cfRes.ok) {
          dnsRecordsUpdated.push({
            recordId,
            name: recordName,
            newIp: tgt.fqdn,
          });
        }
      }
    } catch (cfError) {
      // DNS update gagal tapi server sudah dipindah — catat saja, tidak rollback DB
      console.error('Cloudflare DNS update failed:', cfError);
    }
  }

  // ── Step 4: Catat di audit log ────────────────────────────────────────────
  await logActivity({
    userId: admin.id,
    action: 'admin:node-migrate',
    metadata: {
      source_node_id: sourceNodeId,
      source_node_name: src.name,
      target_node_id: targetNodeId,
      target_node_name: tgt.name,
      servers_moved: serversMoved,
      dns_records_updated: dnsRecordsUpdated.length,
      server_uuids: movedServers.map((s) => s.uuid),
    },
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  return Response.json({
    success: true,
    serversMoved,
    dnsRecordsUpdated,
    error: null,
  });
}
