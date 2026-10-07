import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { isBedrockServer } from '@/lib/minecraft/playerdata';
import {
  bedrockAddonErrorResponse,
  listInstalledBedrockAddons,
} from '@/lib/minecraft/bedrock-addons';
import { resolveServerWings } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** GET /api/servers/{id}/bedrock/addons — daftar pack dan status aktif di world. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.read', params.id);
  if (checked instanceof Response) return checked;
  if (!isBedrockServer(checked.server)) {
    return Response.json({ error: 'Endpoint ini hanya untuk server Bedrock Edition' }, { status: 400 });
  }

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;
  try {
    const result = await listInstalledBedrockAddons(resolved.client, resolved.server.uuid);
    return Response.json(result);
  } catch (error) {
    return bedrockAddonErrorResponse(error);
  }
}
