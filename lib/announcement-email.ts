import 'server-only';

import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { ALL_ACTIVE, sendNotification, type SendNotificationResult } from '@/lib/notifications';
import type { AnnouncementRow } from '@/types';

/**
 * Deliver one active announcement in SMTP-safe batches and mark email_sent only
 * after every verified active recipient accepted the message. Each batch checks
 * the database, so deactivating the announcement stops the next batch.
 */
export async function deliverAnnouncementEmail(
  announcement: AnnouncementRow,
): Promise<{ result: SendNotificationResult | null; email_sent: boolean }> {
  if (!announcement.is_active || !announcement.send_email || announcement.email_sent) {
    return { result: null, email_sent: announcement.email_sent };
  }

  const service = getSupabaseServiceClient();
  const result = await sendNotification(
    ALL_ACTIVE,
    'announcement',
    {
      announcementId: announcement.id,
      title: announcement.title,
      content: announcement.content,
      time: announcement.created_at,
    },
    {
      batchSize: 10,
      delayMs: 1000,
      shouldContinue: async () => {
        const { data } = await service
          .from('announcements')
          .select('is_active, send_email, email_sent')
          .eq('id', announcement.id)
          .maybeSingle();
        return Boolean(data?.is_active && data.send_email && !data.email_sent);
      },
    },
  );

  // A skipped recipient is not considered delivered for an announcement.
  if (!result.cancelled && result.failed === 0 && result.sent === result.total) {
    const { data } = await service
      .from('announcements')
      .update({ email_sent: true })
      .eq('id', announcement.id)
      .eq('is_active', true)
      .eq('send_email', true)
      .eq('email_sent', false)
      .select('email_sent')
      .maybeSingle();
    return { result, email_sent: Boolean(data?.email_sent) };
  }

  return { result, email_sent: false };
}
