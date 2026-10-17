import { canManageVps } from '@/lib/vps/access';
import { isAuthorizedVps, requireVpsAccess, vpsOperationError } from '@/lib/vps/http';
import { execVpsCommand } from '@/lib/vps/ssh';
import {
  maskEnv,
  isSensitiveEnvKey,
  readVpsEnv,
  validateEnvRecord,
  writeVpsEnv,
} from '@/lib/vps/env';
import {
  assertCommandSucceeded,
  getDefaultDeployPath,
  shellQuote,
  validateAppName,
  withPath,
  validateDeployPath,
} from '@/lib/vps/commands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/vps/{id}/env?app=name&deployPath=/home/user/apps/name */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  const url = new URL(request.url);
  const app = url.searchParams.get('app');
  if (!app) return Response.json({ error: 'Parameter app wajib diisi' }, { status: 400 });

  try {
    const appName = validateAppName(app);
    const deployPath = url.searchParams.get('deployPath') || getDefaultDeployPath(access.vps, appName);
    const values = await readVpsEnv(access.vps, validateDeployPath(deployPath));
    return Response.json({ env: maskEnv(values), deploy_path: deployPath });
  } catch (error) {
    return vpsOperationError(error instanceof Error ? error.message : 'Gagal membaca environment variable');
  }
}

/** POST /api/vps/{id}/env — write .env and restart its PM2 process. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireVpsAccess(params.id);
  if (!isAuthorizedVps(access)) return access;
  if (!canManageVps(access.user, access.vps)) {
    return Response.json({ error: 'Hanya pemilik VPS atau admin yang dapat mengubah environment variable' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    app?: unknown;
    deployPath?: unknown;
    env?: unknown;
  } | null;
  if (typeof body?.app !== 'string' || typeof body.deployPath !== 'string') {
    return Response.json({ error: 'Field wajib: app, deployPath, env' }, { status: 400 });
  }

  try {
    const appName = validateAppName(body.app);
    const deployPath = validateDeployPath(body.deployPath);
    const submitted = validateEnvRecord(body.env);
    const existing = await readVpsEnv(access.vps, deployPath);
    const values = Object.fromEntries(
      Object.entries(submitted).map(([key, value]) => [
        key,
        value === '***' && isSensitiveEnvKey(key) && existing[key] !== undefined ? existing[key] : value,
      ]),
    );
    await writeVpsEnv(access.vps, deployPath, values);

    const restart = await execVpsCommand(
      access.vps,
      withPath(`pm2 restart ${shellQuote(appName)}`),
    );
    assertCommandSucceeded(restart, 'Environment tersimpan, tetapi PM2 gagal direstart');
    return Response.json({ success: true, env: maskEnv(values) });
  } catch (error) {
    console.error('Failed to update VPS environment', {
      vpsId: access.vps.id,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return vpsOperationError(error instanceof Error ? error.message : 'Gagal menyimpan environment variable');
  }
}
