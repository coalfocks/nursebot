import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { EVALUATION_SYSTEM_PROMPT, CANONICAL_RUBRIC } from '../_shared/evaluation-prompts.ts';
import { canonicalizeEvaluation, hasMeaningfulEvidence, isLearnerAuthoredEvidence, sanitizeSimulationText, type EvaluationScoringResponse } from '../_shared/evaluation-scoring.ts';
import { FEEDBACK_RUBRIC_VERSION, CASE_KEY_VERSION, ASSESSMENT_VERSION, formativeNotice, normalizeEvidenceEventIds, resolveCaseEvaluationKey } from '../_shared/feedback-contract.ts';
import { filterTimelineToScoringWindow, renderTimelineEntriesForEvaluation, type EvaluationTimelineEntry } from '../_shared/assignment-timeline.ts';
import { isFeedbackEligibleStatus } from '../_shared/feedback-eligibility.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';
import { appendUncitedDeterministicActions } from '../_shared/action-review.ts';
import { FEEDBACK_COMMENT_PROMPT, FEEDBACK_COMMENT_PROMPT_VERSION, validateFeedbackComments, type CommentaryResult } from '../_shared/feedback-comments.ts';

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
                : eventType === 'consultant_request' || eventType === 'consultant_message' || eventType === 'consultant_response'
                  ? 'consultant-message'
                  : 'message';
  const title = eventType === 'student_message'
    ? 'Student message'
    : eventType === 'nurse_message'
      ? 'Nurse message'
      : eventType === 'patient_message'
        ? 'Patient message'
        : eventType === 'consultant_request'
          ? 'Consult request'
          : eventType === 'consultant_response'
            ? 'Consultant response'
            : eventType;
  const content = event.content && typeof event.content === 'object' ? event.content as Record<string, unknown> : {};
  const text = typeof content.text === 'string' ? content.text : Object.entries(content)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' | ');
  const actor = event.actor && typeof event.actor === 'object' ? event.actor as Record<string, unknown> : {};
  const channel = typeof event.channel === 'string' ? event.channel : null;
  const service = event.service && typeof event.service === 'object' ? event.service as Record<string, unknown> : {};
  const actorRole = String(actor.role ?? '').toLowerCase();
  const meta = [
    actor.role ? `Actor: ${actor.role}` : null,
    actorRole === 'student' || actorRole === 'user' ? 'Author: Student' : null,
    actorRole === 'assistant' || actorRole === 'nurse' ? 'Author: Nurse' : null,
    actorRole === 'consultant' ? 'Author: Consultant' : null,
    channel ? `Channel: ${channel}` : null,
    service.label ? `Service: ${service.label}` : null,
    service.audience ? `Audience: ${service.audience}` : null,
    service.urgency ? `Urgency: ${service.urgency}` : null,
    eventType === 'hint_shown' ? 'System hint shown; not a learner action' : null,
    event.ordering_ambiguous ? 'Same-time ordering ambiguous; no clinical sequence asserted' : null,
  ].filter((value): value is string => Boolean(value));
  const timestamp = typeof event.occurred_at === 'string' ? event.occurred_at : null;
  const id = typeof event.event_id === 'string' ? event.event_id : null;
  if (!id) return null;
  return { id, kind, timestamp, title, body: text || undefined, meta, actor_role: typeof actor.role === 'string' ? actor.role.toLowerCase() : null, channel, sequence: typeof event.sequence === 'number' ? event.sequence : null, ordering_ambiguous: event.ordering_ambiguous === true };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let assignmentId: string | undefined;
  let commentsOnly = false;
  try {
    const request = await req.json() as { assignmentId?: string; commentsOnly?: boolean };
    assignmentId = request.assignmentId;
    commentsOnly = request.commentsOnly === true;
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
      const firstPageEventId = typeof scoringBoundary.first_page_event_id === 'string' ? scoringBoundary.first_page_event_id : null;
      const firstPageEvent = firstPageEventId ? events.find((event) => event.event_id === firstPageEventId) : events.find((event) => event.event_type === 'nurse_message' || event.event_type === 'nurse_chat');
      // Older completed attempts may have a blank assignment anchor even though
      // the manifest contains the verified first nurse page. Use that persisted
      // event as the boundary and save the repaired anchor with the result.
      const scoringStartAt = typeof scoringBoundary.scoring_start_at === 'string'
        ? scoringBoundary.scoring_start_at
        : typeof firstPageEvent?.occurred_at === 'string' ? firstPageEvent.occurred_at : null;
      const start = scoringStartAt ? { scoring_start_at: scoringStartAt } : null;
      const boundarySequence = typeof scoringBoundary.sequence === 'number' ? scoringBoundary.sequence : typeof firstPageEvent?.sequence === 'number' ? firstPageEvent.sequence : null;
      const boundaryId = typeof firstPageEvent?.event_id === 'string' ? firstPageEvent.event_id : firstPageEventId;
      const windowEntries = start ? filterTimelineToScoringWindow(entries, start.scoring_start_at, boundaryId, boundarySequence) : { scored: [], uncertain: [] };
      const scoredEntries = windowEntries.scored;
      const missingTimestampEvents = entries.filter((entry) => entry.timestamp == null);
      const uncertainTimestampEvents = [...missingTimestampEvents, ...windowEntries.uncertain];
      const sourceEventIds = scoredEntries.map((entry) => entry.id);
      const key = resolveCaseEvaluationKey(room);
      const provenance = { assignment_id: assignment.id, attempt_id: assignment.id, rubric_version: FEEDBACK_RUBRIC_VERSION, case_key_version: key.version || CASE_KEY_VERSION, assessment_version: ASSESSMENT_VERSION, scoring_start_at: start?.scoring_start_at ?? null, source_event_ids: sourceEventIds };
      if (!start) {
        const result = { technical_incomplete: true, summary: 'This attempt is technically incomplete because no first nurse page was recorded. No learner score was assigned.', formative_notice: formativeNotice };
        const incompleteRun = await client.from('feedback_assessment_runs').insert({ ...provenance, technical_incomplete: true, result }).select('id').single();
        if (incompleteRun.error) throw new Error(incompleteRun.error.message);
        await client.from('student_room_assignments').update({ feedback_status: 'completed', feedback_error: null, scoring_start_at: null, rubric_version: FEEDBACK_RUBRIC_VERSION, case_key_version: key.version || CASE_KEY_VERSION, assessment_version: ASSESSMENT_VERSION, source_event_ids: [], technical_incomplete: true, safety_result: null, feedback_debrief: result, nurse_feedback: result, communication_score: null, mdm_score: null, grade: null, feedback_generated_at: new Date().toISOString() }).eq('id', assignmentId);
        return { runId: incompleteRun.data.id, promptVersion: null };
      }
      if (!hasMeaningfulEvidence(sourceEventIds)) throw new Error('Evidence-bearing attempt produced an empty post-page source event manifest');
      const evidenceManifest = scoredEntries.map((entry) => `${entry.id} | ${entry.kind} | ${entry.title}`).join('\n');
      const allowedEventIds = new Set(sourceEventIds);
      const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
      let commentaryDiagnostic = 'unknown';
      const requestCommentary = async (validationNote = ''): Promise<CommentaryResult | null> => {
        try {
          const completion = await openai.chat.completions.create({
            model: getOpenAIModel('generate_feedback'),
            messages: [{ role: 'system', content: 'Return only the requested JSON object. Do not score or revise the evaluation.' }, { role: 'user', content: `${FEEDBACK_COMMENT_PROMPT}\n\nCASE GOALS:\n${key.goals.join('\n') || 'Not recorded.'}\n\nVERIFIED ATTEMPT TIMELINE:\n${renderTimelineEntriesForEvaluation(scoredEntries)}\n\nLEARNER NOTE:\n${assignment.student_progress_note || 'Not observed.'}\n\nVALID EVIDENCE IDS:\n${evidenceManifest}${validationNote}` }],
            response_format: { type: 'json_object' },
            max_completion_tokens: 3000,
          });
          const rawContent = completion.choices[0].message.content ?? '{}';
          const parsed = JSON.parse(rawContent);
          const validated = validateFeedbackComments(parsed, allowedEventIds);
          if (validated) return validated;
          commentaryDiagnostic = 'model response failed contract validation';
          console.error('Commentary response failed validation', { response_preview: rawContent.slice(0, 1200), valid_event_count: allowedEventIds.size });
          const repair = await openai.chat.completions.create({
            model: getOpenAIModel('generate_feedback'),
            messages: [
              { role: 'system', content: 'Repair the candidate into the exact requested JSON contract. Return JSON only. Do not invent evidence IDs or actions.' },
              { role: 'user', content: `${FEEDBACK_COMMENT_PROMPT}\n\nVALID EVIDENCE IDS:\n${evidenceManifest}\n\nCANDIDATE JSON TO REPAIR:\n${rawContent}\n\nREPAIR REQUIREMENTS: strengths and improvements must each contain exactly two objects; every object must contain text and evidence_event_ids; use only the valid IDs above; each text must be one sentence of no more than 25 words.` },
            ],
            response_format: { type: 'json_object' },
            max_completion_tokens: 3000,
          });
          const repairedContent = repair.choices[0].message.content ?? '{}';
          return validateFeedbackComments(JSON.parse(repairedContent), allowedEventIds);
        } catch (error) {
          commentaryDiagnostic = error instanceof Error ? error.message : String(error);
          console.error('Commentary request failed', error instanceof Error ? error.message : String(error));
          return null;
        }
      };
      if (request.commentsOnly) {
        const initialCommentary = await requestCommentary();
        const commentary = initialCommentary?.status === 'generated'
          ? initialCommentary
          : await requestCommentary('\n\nVALIDATION RETRY: Return exactly two strengths and two improvements. Each must be an object with a concise text sentence of no more than 25 words and at least one exact evidence_event_ids value copied from the valid IDs above. Return JSON only.');
        if (!commentary) throw new Error(`Commentary generation failed validation (${commentaryDiagnostic}); prior feedback was preserved`);
        if (commentary.status !== 'generated') throw new Error(`Commentary generation incomplete: ${commentary.explanation}`);
        const priorDebrief = assignment.feedback_debrief && typeof assignment.feedback_debrief === 'object' && !Array.isArray(assignment.feedback_debrief) ? assignment.feedback_debrief as Record<string, unknown> : {};
        const debrief = { ...priorDebrief, strengths: commentary.comments.strengths, improvements: commentary.comments.improvements, comment_generation_status: commentary.status, comment_prompt_version: commentary.prompt_version, comment_evidence_event_ids: [...new Set([...commentary.comments.strengths, ...commentary.comments.improvements].flatMap((comment) => comment.evidence_event_ids))] };
        const run = await client.from('feedback_assessment_runs').insert({ assignment_id: assignment.id, attempt_id: assignment.id, rubric_version: assignment.rubric_version, case_key_version: assignment.case_key_version, assessment_version: assignment.assessment_version, scoring_start_at: assignment.scoring_start_at, source_event_ids: assignment.source_event_ids ?? sourceEventIds, technical_incomplete: Boolean(assignment.technical_incomplete), result: { mode: 'comments_only', debrief, comment_prompt_version: commentary.prompt_version } }).select('id').single();
        if (run.error) throw run.error;
        const { error: updateError } = await client.from('student_room_assignments').update({ feedback_status: 'completed', feedback_error: null, feedback_generated_at: new Date().toISOString(), feedback_debrief: debrief }).eq('id', assignmentId);
        if (updateError) throw updateError;
        return { runId: run.data.id, promptVersion: commentary.prompt_version };
      }
      const prompt = `${CANONICAL_RUBRIC}\n\nFORMATIVE NOTICE: ${formativeNotice}\n\nCASE-SPECIFIC EVALUATION KEY (${key.version}; guide only, not evidence):\n${JSON.stringify(key, null, 2)}\n\nSCORING BOUNDARY: score only learner actions at or after ${start.scoring_start_at}. Baseline chart context and prior/setup events are excluded.\n\nSCORABLE POST-PAGE EVIDENCE IDS:\n${evidenceManifest}\n\nCURRENT ATTEMPT EVIDENCE (${sourceEventIds.length} timestamped events; actor_role/channel are structured fields):\n${renderTimelineEntriesForEvaluation(scoredEntries)}\n\nEVENTS WITH MISSING OR AMBIGUOUS ORDERING (preserve as uncertainty; do not use to infer in-window action, delay, or omission):\n${uncertainTimestampEvents.map((entry) => JSON.stringify({ id: entry.id, occurred_at: entry.timestamp, sequence: entry.sequence ?? null, ordering_ambiguous: true, kind: entry.kind, title: entry.title, actor_role: entry.actor_role, channel: entry.channel, excerpt: entry.body ?? null })).join('\\n') || 'None.'}\n\nProgress note: ${assignment.student_progress_note || 'Not observed'}\n\nReturn JSON with communication_score, mdm_score (legacy mirror), clinical_reasoning_score; each rubric component as {score: integer|null, feedback, evidence_event_ids, not_scored_reason}; safety_result {level: none|concern|critical|not_assessed, action, rationale, evidence_event_ids}; learning_objectives, strengths, improvements, recommendations, and action_review. Communication components are focused_information_gathering (0-2), closed_loop_team_communication (0-3), efficiency_deduction (-2..0). MDM components are orders_monitoring_quality (0-3), clinical_reasoning_documentation (0-2), safety_deduction (0/-1/-2). A null score requires a concrete missing-source/component reason; a total is null if any dependent component is null. Every cited ID must be copied exactly from the scorable manifest. Use concise exact excerpts when the output supports them. Never infer author or channel from metadata strings. Mark capture gaps unassessable. Preserve observed zero. Include student consultant requests as learner evidence and treat consultant replies as context. Do not return Professionalism, an Overall score, a global multiplier, or a deduction based only on message count/timing.`;
      const requestEvaluation = async (validationNote = '') => {
        const completion = await openai.chat.completions.create({ model: getOpenAIModel('generate_feedback'), messages: [{ role: 'system', content: EVALUATION_SYSTEM_PROMPT }, { role: 'user', content: `${prompt}${validationNote}\n\nOUTPUT FORMAT ONLY: Every one of the six components is {score: integer|null, feedback: string, evidence_event_ids: string[], not_scored_reason: string|null}. Null requires a concrete reason. Include an explanation and evidence for an actual efficiency/safety deduction; use score 0 only when the respective absence/interference finding is assessable.` }], response_format: { type: 'json_object' }, max_completion_tokens: 3000 });
        const parsed = JSON.parse(completion.choices[0].message.content ?? '{}') as Partial<EvaluationScoringResponse> & { action_review?: unknown };
        // Log schema only, never attempt text, to distinguish model output from mapping failures.
        const shape = (value: unknown): unknown => value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item && typeof item === 'object' ? Object.keys(item) : typeof item]))
          : typeof value;
        console.info('Evaluation response schema', JSON.stringify({ keys: Object.keys(parsed), communication: shape(parsed.communication_breakdown), reasoning: shape(parsed.clinical_reasoning_breakdown ?? parsed.mdm_breakdown) }));
        return { evaluation: canonicalizeEvaluation(parsed), actionReview: sanitizeFeedbackTree(parsed.action_review ?? []) };
      };
      let { evaluation, actionReview } = await requestEvaluation();
      const commentary = await requestCommentary();
      if (!commentary || commentary.status !== 'generated') {
        throw new Error(commentary?.status === 'insufficient_evidence' ? `Commentary generation incomplete: ${commentary.explanation}` : 'Commentary generation failed validation');
      }
      const generatedComments = commentary.comments;
      const commentStatus = commentary.status;
      const commentPromptVersion = commentary.prompt_version;
      const idsForKinds = (kinds: string[], learnerOnly = false) => scoredEntries
        .filter((entry) => kinds.includes(entry.kind))
        .filter((entry) => !learnerOnly || isLearnerAuthoredEvidence(entry))
        .map((entry) => entry.id);
      const learnerCommunicationIds = idsForKinds(['message', 'consultant-message', 'learner-action'], true);
      const learnerClosedLoopIds = idsForKinds(['consultant-message', 'learner-action'], true);
      const learnerReasoningIds = idsForKinds(['progress-note', 'message', 'consultant-message', 'order', 'labs', 'vital', 'imaging'], true);
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
      if (!evaluation.communication_breakdown.focused_information_gathering.evidence_event_ids.length && evaluation.communication_breakdown.focused_information_gathering.score != null) evidence.communication.focused = learnerCommunicationIds;
      if (!evaluation.communication_breakdown.closed_loop_team_communication.evidence_event_ids.length && evaluation.communication_breakdown.closed_loop_team_communication.score != null) evidence.communication.closedLoop = learnerClosedLoopIds;
      if (!evaluation.mdm_breakdown.orders_monitoring_quality.evidence_event_ids.length && evaluation.mdm_breakdown.orders_monitoring_quality.score != null) evidence.mdm.orders = idsForKinds(['order', 'labs', 'vital', 'imaging']);
      if (!evaluation.mdm_breakdown.clinical_reasoning_documentation.evidence_event_ids.length && evaluation.mdm_breakdown.clinical_reasoning_documentation.score != null) evidence.mdm.reasoning = learnerReasoningIds;
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
      const debrief = { case_goals: key.goals, approach_summary: evaluation.learning_objectives, strengths: generatedComments.strengths, improvements: generatedComments.improvements, recommendations: evaluation.recommendations, growth_areas: growthAreas, action_review: actionReviewWithKey, safety_result: evaluation.safety_result, scoring_start_at: start.scoring_start_at, comment_generation_status: commentStatus, comment_prompt_version: commentPromptVersion, comment_error: null };
      const legacy = { summary: evaluation.learning_objectives, clinical_reasoning: { score: evaluation.mdm_score, comments: evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback, strengths: [evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback], areas_for_improvement: evaluation.improvements }, communication_skills: { score: evaluation.communication_score, comments: evaluation.communication_breakdown.closed_loop_team_communication.feedback, strengths: [evaluation.communication_breakdown.focused_information_gathering.feedback], areas_for_improvement: evaluation.improvements }, recommendations: evaluation.recommendations };
      const run = await client.from('feedback_assessment_runs').insert({ ...provenance, technical_incomplete: false, result: { evaluation, debrief, comment_prompt_version: commentPromptVersion, comment_generation_status: commentStatus } }).select('id').single();
      if (run.error) throw run.error;
      // mdm_* are retained database compatibility names; the canonical API/UI label is Clinical Reasoning.
      const { error: updateError } = await client.from('student_room_assignments').update({ feedback_status: 'completed', feedback_error: null, communication_score: evaluation.communication_score, mdm_score: evaluation.clinical_reasoning_score, communication_breakdown: evaluation.communication_breakdown, mdm_breakdown: evaluation.clinical_reasoning_breakdown, learning_objectives: evaluation.learning_objectives, grade: null, nurse_feedback: legacy, feedback_generated_at: new Date().toISOString(), scoring_start_at: start.scoring_start_at, rubric_version: FEEDBACK_RUBRIC_VERSION, case_key_version: key.version || CASE_KEY_VERSION, assessment_version: ASSESSMENT_VERSION, source_event_ids: sourceEventIds, technical_incomplete: false, safety_result: evaluation.safety_result, feedback_debrief: debrief }).eq('id', assignmentId);
      if (updateError) throw updateError;
      return { runId: run.data.id, promptVersion: commentPromptVersion };
    })();
    const result = await Promise.race([work, timeout(90000)]) as { runId?: string | null; promptVersion?: string | null };
    return new Response(JSON.stringify({ success: true, assignmentId, ...result }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : (error && typeof error === 'object' && 'message' in error ? String(error.message) : JSON.stringify(error));
    if (assignmentId && !commentsOnly) { const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''); await client.from('student_room_assignments').update({ feedback_status: 'failed', feedback_error: message }).eq('id', assignmentId); }
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
