import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { assignmentUpdateFromVersion, checkPromotable, PROMOTION_FIELDS, snapshotOfficialResult } from '../_shared/feedback-rerun.ts';
import { canAdministerFeedback, resolveFeedbackCaller } from '../_shared/feedback-auth.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Explicit, confirmed promotion of ONE stored rerun version to the official result of ONE assignment.
// The replaced official result is saved in feedback_rerun_versions.promotion_backup first.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { assignmentId, versionId, confirm } = await req.json() as { assignmentId?: string; versionId?: string; confirm?: string };
    if (!assignmentId || !versionId) return json({ error: 'assignmentId and versionId are required' }, 400);
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);
    const caller = await resolveFeedbackCaller(client as never, req.headers.get('Authorization'), serviceKey);
    if (!caller || caller.isService) return json({ error: 'Not authenticated as an admin user' }, 401);

    const { data: assignment, error: assignmentError } = await client.from('student_room_assignments').select(`id, student_id, school_id, status, ${PROMOTION_FIELDS.join(', ')}`).eq('id', assignmentId).maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment || !canAdministerFeedback(caller, assignment)) return json({ error: 'Not allowed for this assignment' }, 403);
    if (assignment.status !== 'completed') return json({ error: 'Assignment is not completed', code: 'NOT_COMPLETED' }, 409);

    const { data: version, error: versionError } = await client.from('feedback_rerun_versions').select('*').eq('id', versionId).maybeSingle();
    if (versionError) throw versionError;
    const check = checkPromotable(version, assignmentId, confirm);
    if (!check.ok) return json({ error: check.message, code: check.code }, check.code === 'CONFIRMATION_REQUIRED' ? 400 : 409);

    // Claim the promotion and store the replaced result in one conditional update.
    const claim = await client.from('feedback_rerun_versions')
      .update({ promoted_at: new Date().toISOString(), promoted_by: caller.userId, promotion_backup: snapshotOfficialResult(assignment) })
      .eq('id', versionId).is('promoted_at', null).select('id');
    if (claim.error) throw claim.error;
    if (!claim.data?.length) return json({ error: 'This rerun was already promoted', code: 'ALREADY_PROMOTED' }, 409);

    const { error: updateError } = await client.from('student_room_assignments').update(assignmentUpdateFromVersion(version)).eq('id', assignmentId).eq('status', 'completed');
    if (updateError) {
      await client.from('feedback_rerun_versions').update({ promoted_at: null, promoted_by: null, promotion_backup: null }).eq('id', versionId);
      throw updateError;
    }
    // Audit row in the run history (best effort; the assignment is already updated).
    if (!version.technical_incomplete) {
      await client.from('feedback_assessment_runs').insert({
        assignment_id: assignmentId, attempt_id: assignmentId, rubric_version: version.provenance?.rubric_version ?? null, case_key_version: version.result?.case_key_version ?? null,
        assessment_version: version.provenance?.assessment_version ?? null, scoring_start_at: version.result?.scoring_start_at ?? null, source_event_ids: version.result?.source_event_ids ?? [],
        technical_incomplete: false, input_fingerprint: version.provenance?.input_fingerprint ?? null,
        result: { evaluation: version.result.evaluation, debrief: version.result.debrief, mode: 'promoted_rerun', rerun_version_id: versionId },
      });
    }
    return json({ success: true, assignmentId, versionId, promotedAt: new Date().toISOString() });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : JSON.stringify(error) }, 500);
  }
});
