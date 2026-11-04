import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { EVALUATION_SYSTEM_PROMPT, CANONICAL_RUBRIC } from '../_shared/evaluation-prompts.ts';
import { buildEvidenceBackedFallback, canonicalizeEvaluation, hasMeaningfulEvidence, sanitizeSimulationText, type EvaluationScoringResponse } from '../_shared/evaluation-scoring.ts';
import { FEEDBACK_RUBRIC_VERSION, CASE_KEY_VERSION, ASSESSMENT_VERSION, formativeNotice, normalizeEvidenceEventIds, resolveCaseEvaluationKey } from '../_shared/feedback-contract.ts';
import { renderTimelineEntriesForEvaluation, type EvaluationTimelineEntry } from '../_shared/assignment-timeline.ts';
import { isFeedbackEligibleStatus } from '../_shared/feedback-eligibility.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';
import { appendUncitedDeterministicActions } from '../_shared/action-review.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('Evaluation scoring timed out')), ms));
const sanitizeFeedbackTree = (value: unknown): unknown => {
  if (typeof value === 'string') return sanitizeSimulationText(value);
  if (Array.isArray(value)) return value.map(sanitizeFeedbackTree);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeFeedbackTree(item)]));
  return value;
};

const manifestEventToEvaluationEntry = (event: Record<string, unknown>): EvaluationTimelineEntry | null => {
  const eventType = String(event.event_type ?? '');
  const kind: EvaluationTimelineEntry['kind'] = eventType === 'order_placed'
    ? 'order'
    : eventType === 'lab_result'
      ? 'labs'
      : eventType === 'vital_observed'
        ? 'vital'
        : eventType === 'imaging_result'
          ? 'imaging'
          : eventType === 'progress_note'
            ? 'progress-note'
            : eventType === 'bedside_action'
              ? 'learner-action'
              : eventType === 'assignment_completed'
                ? 'completion'
                : eventType === 'consultant_message' || eventType === 'consultant_response'
                  ? 'consultant-message'
                  : 'message';
  const content = event.content && typeof event.content === 'object' ? event.content as Record<string, unknown> : {};
  const text = typeof content.text === 'string' ? content.text : Object.entries(content)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' | ');
  const actor = event.actor && typeof event.actor === 'object' ? event.actor as Record<string, unknown> : {};
  const channel = typeof event.channel === 'string' ? event.channel : null;
  const service = event.service && typeof event.service === 'object' ? event.service as Record<string, unknown> : {};
  const meta = [
    actor.role ? `Actor: ${actor.role}` : null,
    channel ? `Channel: ${channel}` : null,
    service.label ? `Service: ${service.label}` : null,
    service.audience ? `Audience: ${service.audience}` : null,
    service.urgency ? `Urgency: ${service.urgency}` : null,
    eventType === 'hint_shown' ? 'System hint shown; not a learner action' : null,
    event.ordering_ambiguous ? 'Same-time ordering ambiguous; no clinical sequence asserted' : null,
  ].filter((value): value is string => Boolean(value));
  const timestamp = typeof event.occurred_at === 'string' ? event.occurred_at : null;
  const id = typeof event.event_id === 'string' ? event.event_id : null;
  if (!id || !timestamp) return null;
  return { id, kind, timestamp, title: eventType, body: text || undefined, meta };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let assignmentId: string | undefined;
  try {
    ({ assignmentId } = await req.json());
    if (!assignmentId) throw new Error('Assignment ID is required');
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const work = (async () => {
      const { data: assignment, error: assignmentError } = await client.from('student_room_assignments').select('*, room:room_id (*)').eq('id', assignmentId).single();
      if (assignmentError) throw assignmentError;
      if (!isFeedbackEligibleStatus(assignment.status)) throw new Error('Cannot generate feedback for incomplete assignment');
      const room = (assignment.room ?? {}) as Record<string, unknown>;
      const { data: canonicalManifest, error: manifestError } = await client.rpc('get_assignment_event_manifest', { p_assignment_id: assignmentId });
      if (manifestError) throw manifestError;
      const manifest = canonicalManifest && typeof canonicalManifest === 'object' ? canonicalManifest as Record<string, unknown> : {};
      const events = Array.isArray(manifest.events) ? manifest.events.filter((event): event is Record<string, unknown> => Boolean(event && typeof event === 'object')) : [];
      const entries = events.map(manifestEventToEvaluationEntry).filter((entry): entry is EvaluationTimelineEntry => Boolean(entry));
      const scoringBoundary = manifest.scoring_boundary && typeof manifest.scoring_boundary === 'object' ? manifest.scoring_boundary as Record<string, unknown> : {};
      const scoringStartAt = typeof scoringBoundary.scoring_start_at === 'string' ? scoringBoundary.scoring_start_at : null;
      const start = scoringStartAt ? { scoring_start_at: scoringStartAt } : null;
      const scoredEntries = start ? entries.filter((entry) => new Date(entry.timestamp).getTime() >= new Date(start.scoring_start_at).getTime()) : [];
      const sourceEventIds = scoredEntries.map((entry) => entry.id);
      const key = resolveCaseEvaluationKey(room);
      const provenance = { assignment_id: assignment.id, attempt_id: assignment.id, rubric_version: FEEDBACK_RUBRIC_VERSION, case_key_version: key.version || CASE_KEY_VERSION, assessment_version: ASSESSMENT_VERSION, scoring_start_at: start?.scoring_start_at ?? null, source_event_ids: sourceEventIds };
      if (!start) {
        const result = { technical_incomplete: true, summary: 'This attempt is technically incomplete because no first nurse page was recorded. No learner score was assigned.', formative_notice: formativeNotice };
        const incompleteRun = await client.from('feedback_assessment_runs').insert({ ...provenance, technical_incomplete: true, result });
        if (incompleteRun.error) throw new Error(incompleteRun.error.message);
        await client.from('student_room_assignments').update({ feedback_status: 'completed', feedback_error: null, scoring_start_at: null, rubric_version: FEEDBACK_RUBRIC_VERSION, case_key_version: key.version || CASE_KEY_VERSION, assessment_version: ASSESSMENT_VERSION, source_event_ids: [], technical_incomplete: true, safety_result: null, feedback_debrief: result, nurse_feedback: result, communication_score: null, mdm_score: null, grade: null, feedback_generated_at: new Date().toISOString() }).eq('id', assignmentId);
        return;
      }
      if (!hasMeaningfulEvidence(sourceEventIds)) throw new Error('Evidence-bearing attempt produced an empty post-page source event manifest');
      const evidenceManifest = scoredEntries.map((entry) => `${entry.id} | ${entry.kind} | ${entry.title}`).join('\n');
      const prompt = `${CANONICAL_RUBRIC}\n\nFORMATIVE NOTICE: ${formativeNotice}\n\nCASE-SPECIFIC EVALUATION KEY (${key.version}):\n${JSON.stringify(key, null, 2)}\n\nSCORING BOUNDARY: score only events at or after ${start.scoring_start_at}. Baseline chart context and prior/setup events are excluded from scores.\n\nPOST-PAGE EVIDENCE MANIFEST (the only valid evidence IDs):\n${evidenceManifest}\n\nCURRENT ATTEMPT EVIDENCE (${sourceEventIds.length} events):\n${renderTimelineEntriesForEvaluation(scoredEntries)}\n\nProgress note: ${assignment.student_progress_note || 'Not observed'}\n\nReturn JSON with communication_score, mdm_score (legacy mirror), clinical_reasoning_score, communication_breakdown.focused_information_gathering (0-2), communication_breakdown.closed_loop_team_communication (0-3), communication_breakdown.efficiency_deduction (-2 to 0), clinical_reasoning_breakdown.orders_monitoring_quality (0-3), clinical_reasoning_breakdown.clinical_reasoning_documentation (0-2), clinical_reasoning_breakdown.safety_deduction (0,-1,-2), safety_result {level, action, rationale, evidence_event_ids}, learning_objectives, strengths, improvements, recommendations, and an action_review array. Every evidence_event_ids value must be copied exactly from the manifest. If a component is not observed, say so and score only that component accordingly; do not zero unrelated components. When an unstable case documents a linked learner-authored bedside finding or team escalation, that observable evidence earns communication credit even if there is no nurse message. Do not return Professionalism, an Overall score, a global multiplier, or a deduction based only on message count/timing.`;
      const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
      const requestEvaluation = async (validationNote = '') => {
        const completion = await openai.chat.completions.create({ model: getOpenAIModel('generate_feedback'), messages: [{ role: 'system', content: EVALUATION_SYSTEM_PROMPT }, { role: 'user', content: `${prompt}${validationNote}` }], response_format: { type: 'json_object' }, max_completion_tokens: 3000 });
        const parsed = JSON.parse(completion.choices[0].message.content ?? '{}') as Partial<EvaluationScoringResponse> & { action_review?: unknown };
        return { evaluation: canonicalizeEvaluation(parsed), actionReview: sanitizeFeedbackTree(parsed.action_review ?? []) };
      };
      let { evaluation, actionReview } = await requestEvaluation();
      if (evaluation.communication_score === 0 && evaluation.clinical_reasoning_score === 0) {
        ({ evaluation, actionReview } = await requestEvaluation('\n\nVALIDATION RETRY: This attempt contains a non-empty post-page evidence manifest. Re-evaluate the observed events and do not return both composite scores as zero unless every post-page event is genuinely non-clinical. Preserve the anchored component ranges and cite manifest IDs.'));
      }
      if (evaluation.communication_score === 0 && evaluation.clinical_reasoning_score === 0) {
        const recovered = buildEvidenceBackedFallback(evaluation, scoredEntries, assignment.student_progress_note);
        if (!recovered) throw new Error('Evidence-bearing attempt returned all-zero Communication and MDM scores after validation retry with no learner-authored post-page action to recover');
        evaluation = recovered;
      }
      const idsForKinds = (kinds: string[], learnerMessagesOnly = false) => scoredEntries
        .filter((entry) => kinds.includes(entry.kind))
        .filter((entry) => !learnerMessagesOnly || entry.kind !== 'message' || entry.meta?.includes('Author: Student'))
        .map((entry) => entry.id);
      const learnerCommunicationIds = idsForKinds(['message', 'learner-action'], true);
      const learnerClosedLoopIds = idsForKinds(['learner-action'], true).filter((id) => scoredEntries.find((entry) => entry.id === id)?.meta?.some((value) => /team|escalat/i.test(value)));
      const learnerReasoningIds = idsForKinds(['progress-note', 'message', 'order', 'labs', 'vital', 'imaging'], true);
      const evidence = {
        communication: {
          focused: normalizeEvidenceEventIds(evaluation.communication_breakdown.focused_information_gathering.evidence_event_ids, learnerCommunicationIds),
          closedLoop: normalizeEvidenceEventIds(evaluation.communication_breakdown.closed_loop_team_communication.evidence_event_ids, learnerClosedLoopIds),
        },
        mdm: {
          orders: normalizeEvidenceEventIds(evaluation.mdm_breakdown.orders_monitoring_quality.evidence_event_ids, idsForKinds(['order', 'labs', 'vital', 'imaging'])),
          reasoning: normalizeEvidenceEventIds(evaluation.mdm_breakdown.clinical_reasoning_documentation.evidence_event_ids, learnerReasoningIds),
        },
      };
      if (!evidence.communication.focused.length) evidence.communication.focused = learnerCommunicationIds;
      if (!evidence.communication.closedLoop.length) evidence.communication.closedLoop = learnerClosedLoopIds;
      if (!evidence.mdm.orders.length) evidence.mdm.orders = idsForKinds(['order', 'labs', 'vital', 'imaging']);
      if (!evidence.mdm.reasoning.length) evidence.mdm.reasoning = learnerReasoningIds;
      evaluation.communication_breakdown.focused_information_gathering.evidence_event_ids = evidence.communication.focused;
      evaluation.communication_breakdown.closed_loop_team_communication.evidence_event_ids = evidence.communication.closedLoop;
      evaluation.communication_breakdown.efficiency_deduction.evidence_event_ids = normalizeEvidenceEventIds(evaluation.communication_breakdown.efficiency_deduction.evidence_event_ids, sourceEventIds);
      evaluation.mdm_breakdown.orders_monitoring_quality.evidence_event_ids = evidence.mdm.orders;
      evaluation.mdm_breakdown.clinical_reasoning_documentation.evidence_event_ids = evidence.mdm.reasoning;
      evaluation.mdm_breakdown.safety_deduction.evidence_event_ids = normalizeEvidenceEventIds(evaluation.mdm_breakdown.safety_deduction.evidence_event_ids, sourceEventIds);
      evaluation.safety_result.evidence_event_ids = normalizeEvidenceEventIds(evaluation.safety_result.evidence_event_ids, sourceEventIds);
      const deterministicEntries = scoredEntries.filter((entry) => ['order', 'labs', 'imaging'].includes(entry.kind));
      const actionReviewWithKey = {
        expected_pathway: { goals: key.goals, expected_endpoint: key.expected_endpoint, time_sensitive_actions: key.time_sensitive_actions, must: key.must, should: key.should, could: key.could, should_not: key.should_not, must_not: key.must_not, acceptable_alternative_paths: key.acceptable_alternative_paths },
        observed_event_ids: sourceEventIds,
        // Preserve a deterministic, human-readable record of every actual
        // post-page order/result even when the model's narrative omits it.
        items: appendUncitedDeterministicActions(Array.isArray(actionReview) ? actionReview : [], deterministicEntries).slice(0, 20),
      };
      const growthEvidence = scoredEntries
        .filter((entry) => ['learner-action', 'order', 'progress-note'].includes(entry.kind))
        .filter((entry) => /monitor|reassess|vital|perfusion|senior|escalat|document/i.test(`${entry.title} ${entry.body ?? ''}`))
        .slice(0, 4)
        .map((entry) => ({ event_id: entry.id, occurred_at: entry.timestamp, label: `${entry.title}: ${entry.body ?? 'Observed post-page action.'}` }));
      const growthAreas = [{
        title: 'Close the loop after urgent monitoring',
        case_goal: key.goals.find((goal) => /monitor|reassess|escalat/i.test(goal)) ?? key.goals[0] ?? 'Link actions to the case goals and observable reassessment.',
        practice_example: 'After urgent monitoring, state when you will repeat vital signs and reassess perfusion, then document the observed result and communicate whether the plan changed.',
        evidence: growthEvidence,
        scoring_start_at: start.scoring_start_at,
      }];
      const debrief = { case_goals: key.goals, approach_summary: evaluation.learning_objectives, strengths: evaluation.strengths.slice(0, 2), improvements: evaluation.improvements, recommendations: evaluation.recommendations, growth_areas: growthAreas, action_review: actionReviewWithKey, safety_result: evaluation.safety_result, scoring_start_at: start.scoring_start_at };
      const legacy = { summary: evaluation.learning_objectives, clinical_reasoning: { score: evaluation.mdm_score, comments: evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback, strengths: [evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback], areas_for_improvement: evaluation.improvements }, communication_skills: { score: evaluation.communication_score, comments: evaluation.communication_breakdown.closed_loop_team_communication.feedback, strengths: [evaluation.communication_breakdown.focused_information_gathering.feedback], areas_for_improvement: evaluation.improvements }, recommendations: evaluation.recommendations };
      const run = await client.from('feedback_assessment_runs').insert({ ...provenance, technical_incomplete: false, result: { evaluation, debrief } }).select('id').single();
      if (run.error) throw run.error;
      // mdm_* are retained database compatibility names; the canonical API/UI label is Clinical Reasoning.
      const { error: updateError } = await client.from('student_room_assignments').update({ feedback_status: 'completed', feedback_error: null, communication_score: evaluation.communication_score, mdm_score: evaluation.clinical_reasoning_score, communication_breakdown: evaluation.communication_breakdown, mdm_breakdown: evaluation.clinical_reasoning_breakdown, learning_objectives: evaluation.learning_objectives, grade: null, nurse_feedback: legacy, feedback_generated_at: new Date().toISOString(), scoring_start_at: start.scoring_start_at, rubric_version: FEEDBACK_RUBRIC_VERSION, case_key_version: key.version || CASE_KEY_VERSION, assessment_version: ASSESSMENT_VERSION, source_event_ids: sourceEventIds, technical_incomplete: false, safety_result: evaluation.safety_result, feedback_debrief: debrief }).eq('id', assignmentId);
      if (updateError) throw updateError;
    })();
    await Promise.race([work, timeout(90000)]);
    return new Response(JSON.stringify({ success: true, assignmentId }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : (error && typeof error === 'object' && 'message' in error ? String(error.message) : JSON.stringify(error));
    if (assignmentId) { const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''); await client.from('student_room_assignments').update({ feedback_status: 'failed', feedback_error: message }).eq('id', assignmentId); }
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
