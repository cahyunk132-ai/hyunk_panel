import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { isPanelAdmin } from '@/lib/auth/roles';
import { getServerByIdOrUuid } from '@/lib/auth/rbac';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { logActivity } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

function parseFutureExpiry(value: unknown): string | null | undefined {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) return undefined;

  const raw = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const parsed = new Date(dateOnly ? `${raw}T23:59:59.999Z` : raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (dateOnly && parsed.toISOString().slice(0, 10) !== raw) return undefined;
  if (parsed.getTime() <= Date.now()) return undefined;
  return parsed.toISOString();
}

/** PATCH /api/admin/servers/{id}/billing — set/reset expiry (Owner Panel/Admin). */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!isPanelAdmin(user.role)) {
    return Response.json({ error: 'Hanya Owner Panel atau Admin yang dapat mengatur billing' }, { status: 403 });
  }

  const server = await getServerByIdOrUuid(params.id);
  if (!server) return Response.json({ error: 'Server tidak ditemukan' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { expires_at?: unknown } | null;
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'expires_at')) {
    return Response.json({ error: 'Field expires_at wajib dikirim (string tanggal atau null)' }, { status: 400 });
  }

  const expiresAt = parseFutureExpiry(body.expires_at);
  if (expiresAt === undefined) {
    return Response.json(
      { error: 'expires_at harus berupa tanggal ISO yang valid dan berada di masa depan' },
      { status: 400 },
    );
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('servers')
    .update({
      expires_at: expiresAt,
      // Perpanjangan billing memulihkan server dari status suspend. Server
      // tetap offline sampai user/admin menyalakannya kembali secara eksplisit.
      is_suspended: false,
      suspended_at: null,
      delete_after_at: null,
    })
    .eq('id', server.id)
    .select('id, name, expires_at, is_suspended, suspended_at, delete_after_at, status')
    .single();

  if (error || !data) {
    return Response.json({ error: error?.message ?? 'Billing server gagal diperbarui' }, { status: 500 });
  }

  await logActivity({
    userId: user.id,
    serverId: server.id,
    action: 'server_billing_update',
    metadata: {
      previous_expires_at: server.expires_at,
      expires_at: expiresAt,
      reset_suspension: true,
    },
  });

  return Response.json({ server: data });
}
