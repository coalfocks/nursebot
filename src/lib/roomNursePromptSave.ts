import type { SupabaseClient } from '@supabase/supabase-js';

export const NURSE_PROMPT_COLUMN = 'nurse_context' as const;

export type NursePromptSaveResult =
  | { ok: true; nurseContext: string; updatedAt: string | null }
  | { ok: false; reason: 'validation' | 'scope_required' | 'school_mismatch' | 'conflict' | 'error'; message: string };

export interface NursePromptSaveInput {
  roomId: number | string;
  roomSchoolId: string | null | undefined;
  /**
   * The school explicitly selected for this write (profile school, or the school a super admin has picked in the scope
   * selector). "All schools" is discovery-only: it arrives here as null/undefined and can never write.
   */
  actorSchoolId: string | null | undefined;
  /** Informational only. Super admins get no exception: every write needs an explicit school equal to the room's school. */
  isSuperAdmin: boolean;
  loadedUpdatedAt: string | null | undefined;
  value: string;
}

/**
 * Scoped save of the nurse prompt only. One atomic conditional UPDATE:
 *   UPDATE rooms SET nurse_context = $v WHERE id = $id AND school_id = $school AND updated_at = $loaded
 * The payload contains exactly one column, so no other field can be overwritten.
 * Zero matched rows => conflict (or RLS filtered), and nothing is written.
 * Pinned scenario baselines on assignments are never touched; they are not
 * part of this statement.
 */
export async function saveRoomNursePrompt(
  client: Pick<SupabaseClient, 'from'>,
  input: NursePromptSaveInput,
): Promise<NursePromptSaveResult> {
  if (input.roomId === undefined || input.roomId === null || input.roomId === '') {
    return { ok: false, reason: 'validation', message: 'Save the room once before saving the nurse prompt independently.' };
  }
  if (!input.roomSchoolId) {
    return { ok: false, reason: 'validation', message: 'This room has no school; cannot scope the nurse prompt save.' };
  }
  // Every write, super admins included, needs an explicit selected school that equals the room's school.
  // A room that is only shared/visible to the selected school (for example the shared Creighton room 202) does not grant write.
  if (!input.actorSchoolId) {
    return { ok: false, reason: 'scope_required', message: 'Select the room\u2019s school in the school selector before saving the nurse prompt. "All schools" is read-only. Nothing was saved.' };
  }
  if (input.actorSchoolId !== input.roomSchoolId) {
    return { ok: false, reason: 'school_mismatch', message: 'This room belongs to a different school than the school you selected. Nothing was saved.' };
  }
  if (!input.value.trim()) {
    return { ok: false, reason: 'validation', message: 'Nurse prompt cannot be empty.' };
  }

  let query = client
    .from('rooms')
    .update({ [NURSE_PROMPT_COLUMN]: input.value })
    .eq('id', input.roomId)
    .eq('school_id', input.roomSchoolId);
  query = input.loadedUpdatedAt == null ? query.is('updated_at', null) : query.eq('updated_at', input.loadedUpdatedAt);

  const { data, error } = await query.select(`${NURSE_PROMPT_COLUMN}, updated_at`).maybeSingle();
  if (error) return { ok: false, reason: 'error', message: error.message || 'Unable to save the nurse prompt.' };
  if (!data) {
    return {
      ok: false,
      reason: 'conflict',
      message: 'Save conflict: this room changed elsewhere (or is outside your access). Nothing was written; reload before retrying.',
    };
  }
  const row = data as unknown as { nurse_context: string | null; updated_at: string | null };
  return { ok: true, nurseContext: row.nurse_context ?? '', updatedAt: row.updated_at ?? null };
}
