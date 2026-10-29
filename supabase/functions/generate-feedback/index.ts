import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { EVALUATION_SYSTEM_PROMPT, CANONICAL_RUBRIC } from '../_shared/evaluation-prompts.ts';
import { canonicalizeEvaluation, hasMeaningfulEvidence, hasValidSixComponentEvaluation, sanitizeSimulationText, type EvaluationScoringResponse } from '../_shared/evaluation-scoring.ts';
import { FEEDBACK_RUBRIC_VERSION, CASE_KEY_VERSION, ASSESSMENT_VERSION, deriveScoringStart, formativeNotice, normalizeEvidenceEventIds, resolveCaseEvaluationKey } from '../_shared/feedback-contract.ts';
import { buildAssignmentTimelineEntries, renderTimelineEntriesForEvaluation, type TimelineConsultantMessageRow, type TimelineImagingRow, type TimelineLabRow, type TimelineLearnerActionRow, type TimelineOrderRow, type TimelinePatientMessageRow, type TimelineVitalRow } from '../_shared/assignment-timeline.ts';
import { isFeedbackEligibleStatus } from '../_shared/feedback-eligibility.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';
import { formatViewedCompletionHintsForEvaluation, getViewedCompletionHints, parseCompletionHints, parseCompletionHintViews } from '../_shared/completion-hints.ts';
import { buildLearnerClosedLoopEvidenceIds, buildLearnerCommunicationEvidenceIds } from '../_shared/feedback-evidence.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('Evaluation scoring timed out')), ms));
const sanitizeFeedbackTree = (value: unknown): unknown => {
  if (typeof value === 'string') return sanitizeSimulationText(value);
  if (Array.isArray(value)) return value.map(sanitizeFeedbackTree);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeFeedbackTree(item)]));
  return value;
};

const emptyEvaluator = { id: null, version: null, evaluator_prompt: '', scoring_anchors: {} };
const schemaNotReady = (detail: string): Error => new Error(`FEEDBACK_SCHEMA_NOT_READY: ${detail}. Apply the reviewed evaluator/integrity migrations, then retry.`);

const assertFeedbackSchemaReady = async (client: any) => {
  const probes = await Promise.all([
    client.from('feedback_evaluator_configs').select('id').limit(1),
    client.from('consultant_chat_messages').select('request_receipt_at, message_sequence').limit(1),
    client.from('medical_orders').select('result_failure_reason, result_attempt_key, result_generation_status').limit(1),
  ]);
  const failed = probes.find((probe) => probe.error);
  if (failed) throw schemaNotReady(failed.error.message);
};

const lineage = async (client: any, roomId: number) => {
  const result: number[] = []; const seen = new Set<number>(); let current: number | null = roomId;
  while (current && !seen.has(current)) { seen.add(current); result.push(current); const response = await client.from('rooms').select('continues_from').eq('id', current).maybeSingle(); if (response.error) throw response.error; const data = response.data as { continues_from?: number | null } | null; current = data?.continues_from ?? null; }
  return result;
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
      await assertFeedbackSchemaReady(client);
      const room = (assignment.room ?? {}) as Record<string, unknown>;
      const roomId = Number(assignment.room_id);
      const { data: roomEvaluator, error: roomEvaluatorError } = await client
        .from('feedback_evaluator_configs')
        .select('id, version, evaluator_prompt, scoring_anchors')
        .eq('scope', 'room').eq('room_id', roomId).eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle();
      if (roomEvaluatorError) throw roomEvaluatorError;
      const { data: globalEvaluator, error: globalEvaluatorError } = await client
        .from('feedback_evaluator_configs')
        .select('id, version, evaluator_prompt, scoring_anchors')
        .eq('scope', 'global').eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle();
      if (globalEvaluatorError) throw globalEvaluatorError;
      const evaluator = roomEvaluator ?? globalEvaluator ?? emptyEvaluator;
      const { data: messages, error: messageError } = await client.from('chat_messages').select('id, assignment_id, role, content, created_at').eq('assignment_id', assignmentId).order('created_at', { ascending: true });
      if (messageError) throw messageError;
      const start = deriveScoringStart(messages ?? []);
      const patientId = typeof room.patient_id === 'string' ? room.patient_id : null;
      const [ordersRes, labsRes, vitalsRes, imagingRes, learnerActionsRes, patientMessagesRes, consultantMessagesRes] = await Promise.all([
        patientId ? client.from('medical_orders').select('id, assignment_id, room_id, override_scope, category, order_name, dose, route, frequency, priority, status, instructions, order_time, created_at, deleted_at').eq('patient_id', patientId).is('deleted_at', null) : Promise.resolve({ data: [], error: null }),
        patientId ? client.from('lab_results').select('id, assignment_id, room_id, override_scope, test_name, value, unit, status, collection_time, result_time, created_at, deleted_at, timeline_entry_id').eq('patient_id', patientId).is('deleted_at', null) : Promise.resolve({ data: [], error: null }),
        patientId ? client.from('vital_signs').select('id, assignment_id, room_id, override_scope, timestamp, temperature, blood_pressure_systolic, blood_pressure_diastolic, heart_rate, respiratory_rate, oxygen_saturation, pain, deleted_at, timeline_entry_id').eq('patient_id', patientId).is('deleted_at', null) : Promise.resolve({ data: [], error: null }),
        patientId ? client.from('imaging_studies').select('id, assignment_id, room_id, override_scope, order_name, study_type, status, report, order_time, report_generated_at, created_at, deleted_at').eq('patient_id', patientId).is('deleted_at', null) : Promise.resolve({ data: [], error: null }),
        client.from('learner_action_events').select('id, assignment_id, room_id, action_type, channel, content, occurred_at, created_at').eq('assignment_id', assignmentId).order('occurred_at', { ascending: true }),
        client.from('patient_chat_messages').select('id, assignment_id, role, content, created_at, client_message_id, reply_to_client_message_id').eq('assignment_id', assignmentId).order('created_at', { ascending: true }),
        client.from('consultant_chat_messages').select('id, assignment_id, role, content, specialty, urgency, request_id, created_at, request_receipt_at, message_sequence').eq('assignment_id', assignmentId).order('request_receipt_at', { ascending: true, nullsFirst: false }).order('message_sequence', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true }),
      ]);
      for (const result of [ordersRes, labsRes, vitalsRes, imagingRes, learnerActionsRes, patientMessagesRes, consultantMessagesRes]) if (result.error) throw result.error;
      const entries = buildAssignmentTimelineEntries({ assignment: { id: assignment.id, completed_at: assignment.completed_at, student_progress_note: assignment.student_progress_note }, assignmentId, targetRoomIds: await lineage(client, roomId), messages: messages ?? [], orders: (ordersRes.data ?? []) as TimelineOrderRow[], labs: (labsRes.data ?? []) as TimelineLabRow[], vitals: (vitalsRes.data ?? []) as TimelineVitalRow[], imaging: (imagingRes.data ?? []) as TimelineImagingRow[], learnerActions: (learnerActionsRes.data ?? []) as TimelineLearnerActionRow[], patientMessages: (patientMessagesRes.data ?? []) as TimelinePatientMessageRow[], consultantMessages: (consultantMessagesRes.data ?? []) as TimelineConsultantMessageRow[] });
      const scoredEntries = start ? entries.filter((entry) => new Date(entry.timestamp).getTime() >= new Date(start.scoring_start_at).getTime()) : [];
      const viewedCompletionHints = getViewedCompletionHints(
        parseCompletionHints(typeof room.completion_hint === 'string' ? room.completion_hint : null),
        parseCompletionHintViews(assignment.completion_hint_views),
      );
      const viewedCompletionHintSummary = formatViewedCompletionHintsForEvaluation(viewedCompletionHints);
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
      const prompt = `${CANONICAL_RUBRIC}\n\n${evaluator.evaluator_prompt || ''}\n\nSCORING ANCHORS (administrator-authored, version ${evaluator.version ?? 'built-in'}):\n${JSON.stringify(evaluator.scoring_anchors ?? {}, null, 2)}\n\nFORMATIVE NOTICE: ${formativeNotice}\n\nCASE-SPECIFIC EVALUATION KEY (${key.version}):\n${JSON.stringify(key, null, 2)}\n\nSCORING BOUNDARY: score only events at or after ${start.scoring_start_at}. Baseline chart context and prior/setup events are excluded from scores.\n\nPOST-PAGE EVIDENCE MANIFEST (the only valid evidence IDs):\n${evidenceManifest}\n\nCURRENT ATTEMPT EVIDENCE (${sourceEventIds.length} events):\n${renderTimelineEntriesForEvaluation(scoredEntries)}\n\nCOMPLETION HINTS VIEWED (context only; never evidence IDs, CAUs, or points by themselves):\n${viewedCompletionHintSummary}\nUse viewed hints only to understand learner-accessible scaffolding when interpreting the assessment, diagnosis, and plan. Do not award or deduct points solely because a hint was viewed, and do not convert hint content into a learner action.\n\nProgress note: ${assignment.student_progress_note || 'Not observed'}\n\nReturn JSON with communication_score, mdm_score (legacy mirror), clinical_reasoning_score, communication_breakdown.focused_information_gathering (0-2), communication_breakdown.closed_loop_team_communication (0-3), communication_breakdown.efficiency_deduction (-2 to 0), clinical_reasoning_breakdown.orders_monitoring_quality (0-3), clinical_reasoning_breakdown.clinical_reasoning_documentation (0-2), clinical_reasoning_breakdown.safety_deduction (0,-1,-2), safety_result {level, action, rationale, evidence_event_ids}, learning_objectives, strengths (maximum 3), improvements (maximum 3), recommendations, and an action_review array. Every evidence_event_ids value must be copied exactly from the manifest. If a component is not observed, say so and score only that component accordingly; do not zero unrelated components. When an unstable case documents a linked learner-authored bedside finding or team escalation, that observable evidence earns communication credit even if there is no nurse message. Do not return Professionalism, an Overall score, a global multiplier, or a deduction based only on message count/timing.`;
      const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
      const requestEvaluation = async (validationNote = '') => {
        const completion = await openai.chat.completions.create({ model: getOpenAIModel('generate_feedback'), messages: [{ role: 'system', content: EVALUATION_SYSTEM_PROMPT }, { role: 'user', content: `${prompt}${validationNote}` }], response_format: { type: 'json_object' }, max_completion_tokens: 3000 });
        const parsed = JSON.parse(completion.choices[0].message.content ?? '{}') as Partial<EvaluationScoringResponse> & { action_review?: unknown };
        if (!hasValidSixComponentEvaluation(parsed as Record<string, unknown>)) throw new Error('Evaluator returned malformed six-component scoring output');
        return { evaluation: canonicalizeEvaluation(parsed), actionReview: sanitizeFeedbackTree(parsed.action_review ?? []) as Array<Record<string, unknown>> };
      };
      let evaluation: EvaluationScoringResponse;
      let actionReview: Array<Record<string, unknown>>;
      try {
        ({ evaluation, actionReview } = await requestEvaluation());
      } catch (firstError) {
        const validationNote = `\n\nVALIDATION RETRY: The prior response failed the six-component schema contract (${firstError instanceof Error ? firstError.message : 'invalid output'}). Return every required component with a numeric score in its declared range; legitimate zero scores are valid.`;
        ({ evaluation, actionReview } = await requestEvaluation(validationNote));
      }
      const idsForKinds = (kinds: string[], learnerMessagesOnly = false) => scoredEntries
        .filter((entry) => kinds.includes(entry.kind))
        .filter((entry) => !learnerMessagesOnly || !['message', 'patient-message', 'consultant-message', 'learner-action'].includes(entry.kind) || entry.meta?.includes('Author: Student'))
        .map((entry) => entry.id);
      const learnerCommunicationIds = buildLearnerCommunicationEvidenceIds(scoredEntries);
      const learnerClosedLoopIds = buildLearnerClosedLoopEvidenceIds(scoredEntries);
      const learnerReasoningIds = idsForKinds(['progress-note', 'message', 'patient-message', 'consultant-message', 'order', 'labs', 'vital', 'imaging'], true);
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
      const actionReviewWithKey = {
        expected_pathway: { goals: key.goals, expected_endpoint: key.expected_endpoint, time_sensitive_actions: key.time_sensitive_actions, must: key.must, should: key.should, could: key.could, should_not: key.should_not, must_not: key.must_not, acceptable_alternative_paths: key.acceptable_alternative_paths },
        observed_event_ids: sourceEventIds,
        // Preserve a deterministic, human-readable record of every actual
        // post-page order/result even when the model's narrative omits it.
        items: [
          ...actionReview,
          ...scoredEntries
            .filter((entry) => ['order', 'labs', 'imaging'].includes(entry.kind))
            .filter((entry) => !actionReview.some((item) => Array.isArray(item.evidence_event_ids) && item.evidence_event_ids.includes(entry.id)))
            .map((entry) => ({
              label: entry.title,
              action: entry.title,
              status: entry.meta?.join(' • ') ?? 'Observed post-page action',
              explanation: entry.body || 'Persisted post-page evidence observed for this attempt.',
              evidence_event_ids: [entry.id],
            })),
        ],
      };
      const debrief = { case_diagnosis: typeof room.expected_diagnosis === 'string' ? room.expected_diagnosis : null, case_goals: key.goals, approach_summary: evaluation.learning_objectives, strengths: evaluation.strengths.slice(0, 3), improvements: evaluation.improvements.slice(0, 3), recommendations: evaluation.recommendations, growth_areas: [], action_review: actionReviewWithKey, evidence_manifest: scoredEntries.map((entry) => ({ id: entry.id, kind: entry.kind, title: entry.title, occurred_at: entry.timestamp })), completion_hints_viewed: viewedCompletionHints.map(({ key: hintKey, label, viewedAt }) => ({ key: hintKey, label, viewed_at: viewedAt })), safety_result: evaluation.safety_result, scoring_start_at: start.scoring_start_at };
      const legacy = { summary: evaluation.learning_objectives, clinical_reasoning: { score: evaluation.mdm_score, comments: evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback, strengths: [evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback], areas_for_improvement: evaluation.improvements }, communication_skills: { score: evaluation.communication_score, comments: evaluation.communication_breakdown.closed_loop_team_communication.feedback, strengths: [evaluation.communication_breakdown.focused_information_gathering.feedback], areas_for_improvement: evaluation.improvements }, recommendations: evaluation.recommendations };
      const run = await client.from('feedback_assessment_runs').insert({ ...provenance, evaluator_config_id: evaluator.id, evaluator_version: evaluator.version, technical_incomplete: false, result: { evaluation, debrief } }).select('id').single();
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
