import 'server-only';
import crypto from 'node:crypto';

/**
 * Validate requests from the external scheduler using CRON_SECRET. Returning
 * a Response keeps route handlers small and
 * ensures missing configuration is never treated as an authorized request.
 */
export function requireCronSecret(request: Request): Response | null {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret) {
    return Response.json({ error: 'CRON_SECRET belum di-set di environment' }, { status: 500 });
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
