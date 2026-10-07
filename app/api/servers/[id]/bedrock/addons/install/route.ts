import { requireUser } from '@/lib/auth/session';
import { checkPermission, getEffectivePermissions, permissionsInclude } from '@/lib/auth/rbac';
import { isBedrockServer } from '@/lib/minecraft/playerdata';
import {
  bedrockAddonErrorResponse,
  installBedrockAddon,
} from '@/lib/minecraft/bedrock-addons';
import { logActivity, resolveServerWings } from '@/lib/wings/resolve';

export const runtime = 'nodejs';

/**
 * POST /api/servers/{id}/bedrock/addons/install
 * Body: { file_url, filename, project_type }. Unduhan dan ekstraksi hanya
 * dilakukan pada Node.js server; browser hanya mengirim metadata Modrinth.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await requireUser();
  if (user instanceof Response) return user;

  const checked = await checkPermission(user, 'files.edit', params.id);
  if (checked instanceof Response) return checked;
  if (!isBedrockServer(checked.server)) {
    return Response.json({ error: 'Endpoint ini hanya untuk server Bedrock Edition' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { file_url?: unknown; filename?: unknown; project_type?: unknown }
    | null;
  if (
    !body ||
    typeof body.file_url !== 'string' ||
    typeof body.filename !== 'string' ||
    typeof body.project_type !== 'string'
  ) {
    return Response.json(
      { error: 'Field wajib: file_url, filename, project_type' },
      { status: 400 },
    );
  }

  const resolved = await resolveServerWings(checked.server);
  if (resolved instanceof Response) return resolved;

  try {
    const result = await installBedrockAddon(resolved.client, resolved.server.uuid, {
      file_url: body.file_url,
      filename: body.filename,
      project_type: body.project_type,
    });

    let educationFeaturesEnabled: boolean | null = null;
    let educationFeaturesMessage: string | null = null;
    if (result.requires_education_features) {
      const permissions = await getEffectivePermissions(user, checked.server);
      if (!permissionsInclude(permissions, 'console.send')) {
        educationFeaturesEnabled = false;
        educationFeaturesMessage = 'Permission console.send diperlukan untuk menjalankan changesetting education-features-enabled true.';
      } else {
        try {
          await resolved.client.sendCommands(resolved.server.uuid, [
            'changesetting education-features-enabled true',
          ]);
          educationFeaturesEnabled = true;
        } catch (error) {
          educationFeaturesEnabled = false;
          educationFeaturesMessage = error instanceof Error ? error.message : 'Command console gagal dikirim.';
        }
      }
    }

    await logActivity({
      userId: user.id,
      serverId: resolved.server.id,
      action: 'bedrock:addon-install',
      metadata: {
        filename: body.filename,
        project_type: body.project_type,
        packs: result.packs.map((pack) => ({ pack_id: pack.pack_id, type: pack.type })),
        requires_education_features: result.requires_education_features,
        education_features_enabled: educationFeaturesEnabled,
      },
    });

    return Response.json({
      success: true,
      ...result,
      education_features_enabled: educationFeaturesEnabled,
      education_features_message: educationFeaturesMessage,
    });
  } catch (error) {
    return bedrockAddonErrorResponse(error);
  }
}
