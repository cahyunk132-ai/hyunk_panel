import { requireUser } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/rbac';
import { isBedrockServer } from '@/lib/minecraft/playerdata';
import {
  bedrockAddonErrorResponse,
  deleteInstalledBedrockAddon,
} from '@/lib/minecraft/bedrock-addons';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/** DELETE /api/servers/{id}/bedrock/addons/{pack_id} */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; pack_id: string } },
) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;
  if (!isBedrockServer(checked.server)) {
    return Response.json({ error: 'Endpoint ini hanya untuk server Bedrock Edition' }, { status: 400 });
  }

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;
  try {
    const result = await deleteInstalledBedrockAddon(resolved.client, resolved.server.uuid, params.pack_id);
    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'bedrock:addon-delete',
      metadata: result,
    });
    return Response.json({ success: true, ...result });
  } catch (error) {
    return bedrockAddonErrorResponse(error);
  }
}
