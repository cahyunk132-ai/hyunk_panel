import 'server-only';

import nodemailer from 'nodemailer';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { NotificationSettingsRow, NotificationType, UserRole } from '@/types';
import { getSupabaseServiceClient } from '@/lib/supabase/server';

const DEFAULT_SETTINGS: Omit<NotificationSettingsRow, 'user_id'> = {
  notify_backup_failed: true,
  notify_backup_success: false,
  notify_server_crash: true,
  notify_node_offline: true,
  email_override: null,
};

const ALL_ADMINS = 'all_admins';
const ALL_ACTIVE = 'all_active';
const MAX_PAGE_SIZE = 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type NotificationSettingKey =
  | 'notify_backup_failed'
  | 'notify_backup_success'
  | 'notify_server_crash'
  | 'notify_node_offline';

export interface NotificationData {
  serverName?: string;
  serverId?: string;
  nodeName?: string;
  nodeId?: string;
  error?: string;
  title?: string;
  content?: string;
  announcementId?: string;
  time?: string | Date;
  [key: string]: unknown;
}

export interface SendNotificationOptions {
  /** Used by announcement delivery to stop when the admin disables it. */
  shouldContinue?: () => Promise<boolean>;
  batchSize?: number;
  delayMs?: number;
}

export interface SendNotificationResult {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  cancelled: boolean;
  completed: boolean;
  error?: string;
}

interface Recipient {
  userId: string;
  username: string;
  email: string | null;
  role: UserRole;
  emailOverride: string | null;
}

interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

type AuthUserWithStatus = User & { banned_until?: string | null };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isActiveVerified(user: AuthUserWithStatus): boolean {
  const deletedAt = (user as AuthUserWithStatus & { deleted_at?: string | null }).deleted_at;
  const bannedUntil = user.banned_until ? new Date(user.banned_until).getTime() : 0;
  const currentlyBanned = Number.isFinite(bannedUntil) && bannedUntil > Date.now();
  return Boolean(user.email && user.email_confirmed_at && !currentlyBanned && !deletedAt);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function panelUrl(path = ''): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://panel.wangstore.web.id').replace(/\/$/, '');
  return `${base}${path.startsWith('/') || !path ? path : `/${path}`}`;
}

function displayTime(value?: string | Date): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString('id-ID');
  return date.toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  });
}

function preferenceKey(type: NotificationType): NotificationSettingKey | null {
  if (
    type === 'backup_failed' ||
    type === 'backup_success' ||
    type === 'server_crash' ||
    type === 'node_offline'
  ) {
    return `notify_${type}` as NotificationSettingKey;
  }
  return null;
}

function settingFromRow(row: Partial<NotificationSettingsRow> | null | undefined) {
  return {
    ...DEFAULT_SETTINGS,
    ...(row ?? {}),
  };
}

function renderEmail(type: NotificationType, data: NotificationData): RenderedEmail {
  const time = displayTime(data.time);
  const serverName = data.serverName ?? 'Server';
  const nodeName = data.nodeName ?? 'Node';
  const error = data.error ?? 'Error tidak diketahui';
  const title = data.title ?? 'Announcement';
  const content = data.content ?? '';
  const lineBreaks = (value: string) => escapeHtml(value).replaceAll('\n', '<br />');

  switch (type) {
    case 'backup_failed': {
      const subject = `❌ Backup Gagal — ${serverName}`;
      const text = `Backup otomatis server ${serverName} pada ${time} gagal.\nError: ${error}\n\nSilakan cek panel untuk detail lebih lanjut.\n${panelUrl('/admin/backups')}`;
      return {
        subject,
        text,
        html: emailLayout(
          subject,
          `<p>Backup otomatis server <strong>${escapeHtml(serverName)}</strong> pada ${escapeHtml(time)} gagal.</p><p><strong>Error:</strong> ${escapeHtml(error)}</p>`,
          panelUrl('/admin/backups'),
          'Lihat di Panel',
        ),
      };
    }
    case 'backup_success': {
      const subject = `✅ Backup Berhasil — ${serverName}`;
      const text = `Backup otomatis server ${serverName} pada ${time} berhasil disimpan.\n\n${panelUrl('/admin/backups')}`;
      return {
        subject,
        text,
        html: emailLayout(
          subject,
          `<p>Backup otomatis server <strong>${escapeHtml(serverName)}</strong> pada ${escapeHtml(time)} berhasil disimpan.</p>`,
          panelUrl('/admin/backups'),
          'Lihat Backup',
        ),
      };
    }
    case 'server_crash': {
      const subject = `🔴 Server Mati — ${serverName}`;
      const consolePath = data.serverId ? `/servers/${data.serverId}/console` : '/servers';
      const text = `Server ${serverName} terdeteksi mati pada ${time}.\nNode: ${nodeName}\n\n${panelUrl(consolePath)}`;
      return {
        subject,
        text,
        html: emailLayout(
          subject,
          `<p>Server <strong>${escapeHtml(serverName)}</strong> terdeteksi mati pada ${escapeHtml(time)}.</p><p>Node: <strong>${escapeHtml(nodeName)}</strong></p>`,
          panelUrl(consolePath),
          'Buka Console',
        ),
      };
    }
    case 'node_offline': {
      const subject = `⚠️ Node Offline — ${nodeName}`;
      const text = `Node ${nodeName} tidak dapat dihubungi sejak ${time}.\nSemua server di node ini mungkin tidak dapat diakses.\n\n${panelUrl('/nodes')}`;
      return {
        subject,
        text,
        html: emailLayout(
          subject,
          `<p>Node <strong>${escapeHtml(nodeName)}</strong> tidak dapat dihubungi sejak ${escapeHtml(time)}.</p><p>Semua server di node ini mungkin tidak dapat diakses.</p>`,
          panelUrl('/nodes'),
          'Buka Panel',
        ),
      };
    }
    case 'announcement': {
      const subject = `📢 ${title} — AULA WANG Panel`;
      const text = `Ada pengumuman baru dari tim AULA WANG:\n\n${title}\n${content}\n\nLihat selengkapnya di panel kamu.\n${panelUrl('/dashboard')}`;
      return {
        subject,
        text,
        html: emailLayout(
          subject,
          `<p>Ada pengumuman baru dari tim AULA WANG:</p><h2>${escapeHtml(title)}</h2><p>${lineBreaks(content)}</p>`,
          panelUrl('/dashboard'),
          'Buka Panel',
        ),
      };
    }
    case 'test': {
      const subject = '✅ Test Notifikasi — HYUNK PANEL';
      const text = `Ini adalah email test notifikasi dari HYUNK PANEL pada ${time}.\nKonfigurasi email kamu berhasil digunakan.\n\n${panelUrl('/settings/notifications')}`;
      return {
        subject,
        text,
        html: emailLayout(
          subject,
          `<p>Ini adalah email test notifikasi dari HYUNK PANEL pada ${escapeHtml(time)}.</p><p>Konfigurasi email kamu berhasil digunakan.</p>`,
          panelUrl('/settings/notifications'),
          'Buka Pengaturan',
        ),
      };
    }
  }
}

function emailLayout(subject: string, body: string, href: string, buttonLabel: string): string {
  return `<!doctype html><html><body style="margin:0;background:#11151d;color:#e8edf5;font-family:Arial,sans-serif;padding:32px 16px"><div style="max-width:580px;margin:0 auto;background:#1a202b;border:1px solid #30394a;border-radius:12px;padding:28px"><p style="margin:0 0 20px;color:#3ecfcf;font-size:12px;font-weight:700;letter-spacing:2px">HYUNK PANEL</p><h1 style="font-size:20px;line-height:1.35;margin:0 0 20px;color:#f6f8fb">${escapeHtml(subject)}</h1><div style="font-size:14px;line-height:1.7;color:#c7d0df">${body}</div><p style="margin:26px 0 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#3ecfcf;color:#071013;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:8px">${escapeHtml(buttonLabel)}</a></p></div></body></html>`;
}

function createTransporter() {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) throw new Error('SMTP_HOST belum di-set di environment');

  const port = Number.parseInt(process.env.SMTP_PORT ?? '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;

  return nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    ...(user ? { auth: { user, pass: password ?? '' } } : {}),
  });
}

function senderAddress(): string {
  return process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim() || 'no-reply@wangstore.web.id';
}

async function listVerifiedRecipients(
  service: SupabaseClient,
  filter?: (role: UserRole) => boolean,
): Promise<Recipient[]> {
  const authUsers: AuthUserWithStatus[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: MAX_PAGE_SIZE });
    if (error) throw new Error(`Gagal mengambil daftar user email: ${error.message}`);
    const users = (data?.users ?? []) as AuthUserWithStatus[];
    authUsers.push(...users.filter(isActiveVerified));
    if (users.length < MAX_PAGE_SIZE) break;
  }

  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const ids = Array.from(authById.keys());
  if (ids.length === 0) return [];

  const { data: profiles, error } = await service
    .from('users')
    .select('id, username, email, role')
    .in('id', ids);
  if (error) throw new Error(`Gagal mengambil profil user email: ${error.message}`);

  return (profiles ?? [])
    .map((profile) => {
      const row = profile as { id: string; username: string; email: string | null; role: UserRole };
      const auth = authById.get(row.id);
      return {
        userId: row.id,
        username: row.username,
        email: auth?.email ?? row.email,
        role: row.role,
        emailOverride: null,
      } satisfies Recipient;
    })
    .filter((recipient) => (filter ? filter(recipient.role) : true));
}

async function recipientById(service: SupabaseClient, userId: string): Promise<Recipient | null> {
  const { data: authData, error: authError } = await service.auth.admin.getUserById(userId);
  if (authError || !authData.user || !isActiveVerified(authData.user as AuthUserWithStatus)) return null;

  const { data: profile, error } = await service
    .from('users')
    .select('id, username, email, role')
    .eq('id', userId)
    .maybeSingle();
  if (error || !profile) return null;

  const row = profile as { id: string; username: string; email: string | null; role: UserRole };
  return {
    userId: row.id,
    username: row.username,
    email: (authData.user as User).email ?? row.email,
    role: row.role,
    emailOverride: null,
  };
}

async function loadSettings(
  service: SupabaseClient,
  userIds: string[],
): Promise<Map<string, ReturnType<typeof settingFromRow>>> {
  const result = new Map<string, ReturnType<typeof settingFromRow>>();
  if (userIds.length === 0) return result;

  const { data } = await service
    .from('notification_settings')
    .select('user_id, notify_backup_failed, notify_backup_success, notify_server_crash, notify_node_offline, email_override')
    .in('user_id', userIds);
  for (const row of (data ?? []) as Array<Partial<NotificationSettingsRow> & { user_id: string }>) {
    result.set(row.user_id, settingFromRow(row));
  }
  return result;
}

async function logNotification(
  service: SupabaseClient,
  input: {
    recipient: Recipient;
    type: NotificationType;
    subject: string;
    status: 'sent' | 'failed' | 'skipped';
    error?: string;
    metadata: NotificationData;
  },
): Promise<void> {
  await service.from('notification_logs').insert({
    user_id: input.recipient.userId,
    notification_type: input.type,
    recipient_email: input.recipient.emailOverride || input.recipient.email,
    subject: input.subject,
    status: input.status,
    error_message: input.error ?? null,
    metadata: input.metadata,
    sent_at: input.status === 'sent' ? new Date().toISOString() : null,
  });
}

async function deliverToRecipient(
  service: SupabaseClient,
  transporter: ReturnType<typeof createTransporter>,
  recipient: Recipient,
  type: NotificationType,
  data: NotificationData,
  settings: ReturnType<typeof settingFromRow>,
): Promise<'sent' | 'failed' | 'skipped'> {
  const rendered = renderEmail(type, data);
  const preference = preferenceKey(type);
  if (preference && !settings[preference]) {
    await logNotification(service, {
      recipient,
      type,
      subject: rendered.subject,
      status: 'skipped',
      error: 'Notifikasi dinonaktifkan oleh user',
      metadata: data,
    });
    return 'skipped';
  }

  const target = settings.email_override?.trim() || recipient.email;
  if (!target || !EMAIL_RE.test(target)) {
    await logNotification(service, {
      recipient: { ...recipient, emailOverride: target ?? null },
      type,
      subject: rendered.subject,
      status: 'skipped',
      error: 'Email recipient tidak tersedia atau tidak valid',
      metadata: data,
    });
    return 'skipped';
  }

  try {
    await transporter.sendMail({
      from: senderAddress(),
      to: target,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    await logNotification(service, {
      recipient: { ...recipient, emailOverride: target },
      type,
      subject: rendered.subject,
      status: 'sent',
      metadata: data,
    });
    return 'sent';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SMTP error';
    await logNotification(service, {
      recipient: { ...recipient, emailOverride: target },
      type,
      subject: rendered.subject,
      status: 'failed',
      error: message,
      metadata: data,
    });
    return 'failed';
  }
}

/**
 * Send one event notification, a broadcast to all active verified users, or a
 * broadcast to all panel administrators. SMTP and credential handling stay on
 * the server. The default broadcast pacing is 10 emails per second.
 */
export async function sendNotification(
  userId: string,
  type: NotificationType,
  data: NotificationData = {},
  options: SendNotificationOptions = {},
): Promise<SendNotificationResult> {
  const service = getSupabaseServiceClient();
  let recipients: Recipient[];

  try {
    if (userId === ALL_ACTIVE) {
      recipients = await listVerifiedRecipients(service);
    } else if (userId === ALL_ADMINS) {
      recipients = await listVerifiedRecipients(
        service,
        (role) => role === 'owner_panel' || role === 'admin',
      );
    } else {
      const recipient = await recipientById(service, userId);
      recipients = recipient ? [recipient] : [];
    }
  } catch (error) {
    return {
      total: 0,
      sent: 0,
      failed: 1,
      skipped: 0,
      cancelled: false,
      completed: false,
      error: error instanceof Error ? error.message : 'Gagal mengambil recipient email',
    };
  }

  if (recipients.length === 0) {
    return { total: 0, sent: 0, failed: 0, skipped: 0, cancelled: false, completed: true };
  }

  const settings = await loadSettings(service, recipients.map((recipient) => recipient.userId));
  const preference = preferenceKey(type);
  const eligible: Recipient[] = [];
  let skipped = 0;
  for (const recipient of recipients) {
    const currentSettings = settingFromRow(settings.get(recipient.userId));
    const rendered = renderEmail(type, data);
    const target = currentSettings.email_override?.trim() || recipient.email;
    if ((preference && !currentSettings[preference]) || !target || !EMAIL_RE.test(target)) {
      await logNotification(service, {
        recipient: { ...recipient, emailOverride: target ?? null },
        type,
        subject: rendered.subject,
        status: 'skipped',
        error: preference && !currentSettings[preference]
          ? 'Notifikasi dinonaktifkan oleh user'
          : 'Email recipient tidak tersedia atau tidak valid',
        metadata: data,
      });
      skipped += 1;
      continue;
    }
    eligible.push(recipient);
  }

  if (eligible.length === 0) {
    return {
      total: recipients.length,
      sent: 0,
      failed: 0,
      skipped,
      cancelled: false,
      completed: true,
    };
  }

  let transporter: ReturnType<typeof createTransporter>;
  try {
    transporter = createTransporter();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SMTP belum dikonfigurasi';
    await Promise.all(
      eligible.map((recipient) => {
        const rendered = renderEmail(type, data);
        return logNotification(service, {
          recipient,
          type,
          subject: rendered.subject,
          status: 'failed',
          error: message,
          metadata: data,
        });
      }),
    );
    return {
      total: recipients.length,
      sent: 0,
      failed: eligible.length,
      skipped,
      cancelled: false,
      completed: false,
      error: message,
    };
  }
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 10, 100));
  const delayMs = Math.max(0, options.delayMs ?? 1000);
  const result: SendNotificationResult = {
    total: recipients.length,
    sent: 0,
    failed: 0,
    skipped,
    cancelled: false,
    completed: false,
  };

  for (let offset = 0; offset < eligible.length; offset += batchSize) {
    if (options.shouldContinue && !(await options.shouldContinue())) {
      result.cancelled = true;
      break;
    }

    const batch = eligible.slice(offset, offset + batchSize);
    const outcomes = await Promise.all(
      batch.map((recipient) =>
        deliverToRecipient(
          service,
          transporter,
          recipient,
          type,
          data,
          settingFromRow(settings.get(recipient.userId)),
        ),
      ),
    );
    for (const outcome of outcomes) {
      if (outcome === 'sent') result.sent += 1;
      else if (outcome === 'failed') result.failed += 1;
      else result.skipped += 1;
    }

    if (offset + batchSize < eligible.length) await sleep(delayMs);
  }

  result.completed = !result.cancelled && result.failed === 0;
  return result;
}

export { ALL_ACTIVE, ALL_ADMINS };
