import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import type { PublicNotificationSettings } from '@/types';

export const runtime = 'nodejs';

const DEFAULT_SETTINGS: PublicNotificationSettings = {
  notify_backup_failed: true,
  notify_backup_success: false,
  notify_server_crash: true,
  notify_node_offline: true,
  email_override: null,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SETTINGS_COLUMNS =
  'notify_backup_failed, notify_backup_success, notify_server_crash, notify_node_offline, email_override';

/** GET /api/settings/notifications — current user preferences. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('notification_settings')
    .select(SETTINGS_COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    settings: {
      ...DEFAULT_SETTINGS,
      ...(data ?? {}),
    } satisfies PublicNotificationSettings,
  });
}

/** PATCH /api/settings/notifications — update toggles and optional email. */
export async function PATCH(request: NextRequest) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Body tidak valid' }, { status: 400 });
  }

  const patch: Record<string, boolean | string | null> = {};
  for (const key of [
    'notify_backup_failed',
    'notify_backup_success',
    'notify_server_crash',
    'notify_node_offline',
  ]) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'boolean') {
        return Response.json({ error: `${key} harus boolean` }, { status: 400 });
      }
      patch[key] = body[key] as boolean;
    }
  }

  if (body.email_override !== undefined) {
    if (body.email_override !== null && typeof body.email_override !== 'string') {
      return Response.json({ error: 'email_override harus berupa email atau null' }, { status: 400 });
    }
    const email = typeof body.email_override === 'string' ? body.email_override.trim() : '';
    if (email && (email.length > 320 || !EMAIL_RE.test(email))) {
      return Response.json({ error: 'Format email alternatif tidak valid' }, { status: 400 });
    }
    patch.email_override = email || null;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: 'Tidak ada pengaturan yang diubah' }, { status: 400 });
  }

  const service = getSupabaseServiceClient();
  const { data, error } = await service
    .from('notification_settings')
    .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })
    .select(SETTINGS_COLUMNS)
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    ok: true,
    settings: { ...DEFAULT_SETTINGS, ...data } satisfies PublicNotificationSettings,
  });
}
