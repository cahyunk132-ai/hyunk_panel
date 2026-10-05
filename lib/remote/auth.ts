import 'server-only';
import crypto from 'node:crypto';
import type { NodeRow } from '@/types';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import { decryptToken } from '@/lib/wings/crypto';

/**
 * Autentikasi untuk Remote API (Wings → Panel).
 *
 * Wings remote client mengirim:  Authorization: Bearer {token_id}.{token}
 * (diverifikasi dari wings remote/http.go: fmt.Sprintf("Bearer %s.%s", tokenId, token)).
 * Kita juga menerima pemisah "|" sebagai toleransi.
 */
export async function authenticateWings(request: Request): Promise<NodeRow | Response> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return Response.json({ error: 'Missing Authorization header' }, { status: 401 });
  }

  const raw = match[1];
  const sepIdx = raw.includes('.') ? raw.indexOf('.') : raw.indexOf('|');
  if (sepIdx <= 0) {
    return Response.json({ error: 'Malformed token' }, { status: 401 });
  }
  const tokenId = raw.slice(0, sepIdx);
  const token = raw.slice(sepIdx + 1);

  const service = getSupabaseServiceClient();
  const { data: node } = await service
    .from('nodes')
    .select('*')
    .eq('token_id', tokenId)
    .maybeSingle();
  if (!node) {
    return Response.json({ error: 'Node tidak dikenal' }, { status: 403 });
  }

  let expected: string;
  try {
    expected = decryptToken((node as NodeRow).token_encrypted);
  } catch {
    return Response.json({ error: 'Konfigurasi token node invalid' }, { status: 500 });
  }

  const a = Buffer.from(token, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || crypto.timingSafeEqual(a, b) === false) {
    return Response.json({ error: 'Token tidak valid' }, { status: 403 });
  }

  return node as NodeRow;
}

export function isResponse(v: unknown): v is Response {
  return v instanceof Response;
}
