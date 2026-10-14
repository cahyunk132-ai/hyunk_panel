import { requireUser } from '@/lib/auth/session';
import { sendNotification } from '@/lib/notifications';

export const runtime = 'nodejs';

/** POST /api/settings/notifications/test — send one test email to the user. */
export async function POST() {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const result = await sendNotification(user.id, 'test', { time: new Date() });
  if (result.failed > 0 || !result.completed) {
    return Response.json(
      {
        error: result.error ?? 'Email test gagal dikirim. Periksa konfigurasi SMTP.',
        result,
      },
      { status: 502 },
    );
  }
  if (result.sent === 0) {
    return Response.json(
      { error: 'Email akun belum terverifikasi atau alamat email tidak tersedia.', result },
      { status: 400 },
    );
  }
  return Response.json({ ok: true, message: 'Email test berhasil dikirim.', result });
}
