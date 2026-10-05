import { NextRequest } from 'next/server';
import { authenticateWings } from '@/lib/remote/auth';

export const runtime = 'nodejs';

/**
 * GET /api/remote/credentials — info endpoint SFTP untuk node ini.
 * Autentikasi kredential user itu sendiri dilakukan di POST /api/remote/sftp.
 */
export async function GET(request: NextRequest) {
  const node = await authenticateWings(request);
  if (node instanceof Response) return node;

  return Response.json({
    data: {
      sftp: {
        host: node.fqdn,
        port: 2022,
        username_format: '{username}.{prefix-uuid-server}',
        auth_endpoint: '/api/remote/sftp',
      },
    },
  });
}
