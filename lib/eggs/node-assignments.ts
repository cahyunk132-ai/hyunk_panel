import type { SupabaseClient } from '@supabase/supabase-js';

export async function validateNodeIds(
  service: SupabaseClient,
  nodeIds: string[],
): Promise<string | null> {
  if (nodeIds.length === 0) return null;
  const { data, error } = await service.from('nodes').select('id').in('id', nodeIds);
  if (error) return error.message;
  if ((data ?? []).length !== nodeIds.length) return 'Satu atau beberapa node tidak ditemukan.';
  return null;
}

/** Update relasi hanya untuk node yang berubah (tidak menghapus seluruh assignment). */
export async function replaceEggNodeAssignments(
  service: SupabaseClient,
  eggId: string,
  nodeIds: string[],
): Promise<string | null> {
  const validationError = await validateNodeIds(service, nodeIds);
  if (validationError) return validationError;

  const { data: currentRows, error: currentError } = await service
    .from('node_eggs')
    .select('node_id')
    .eq('egg_id', eggId);
  if (currentError) return currentError.message;

  const currentIds = new Set((currentRows ?? []).map((row) => row.node_id as string));
  const nextIds = new Set(nodeIds);
  const removeIds = Array.from(currentIds).filter((id) => !nextIds.has(id));
  const addIds = Array.from(nextIds).filter((id) => !currentIds.has(id));

  if (removeIds.length > 0) {
    const { error } = await service
      .from('node_eggs')
      .delete()
      .eq('egg_id', eggId)
      .in('node_id', removeIds);
    if (error) return error.message;
  }
  if (addIds.length > 0) {
    const { error } = await service
      .from('node_eggs')
      .insert(addIds.map((nodeId) => ({ node_id: nodeId, egg_id: eggId })));
    if (error) return error.message;
  }
  return null;
}
