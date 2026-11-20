import { supabase } from './supabase';

/**
 * Records Case Start for an assignment exactly once.
 * The `case_started_at is null` guard means a reload, a repeated transition, or a feedback rerun can never
 * overwrite the first recorded start. Only call this on the assigned -> in_progress transition.
 */
export async function recordCaseStartOnce(assignmentId: string, startedAt: string = new Date().toISOString()): Promise<void> {
  const { error } = await supabase
    .from('student_room_assignments')
    .update({ case_started_at: startedAt })
    .eq('id', assignmentId)
    .is('case_started_at', null);
  if (error) throw error;
}
