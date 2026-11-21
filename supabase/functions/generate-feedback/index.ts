import { diagnosticFetch, type ModelTransportAttempt } from '../_shared/model-transport-diagnostics.ts';
import { buildCommentaryContext, buildCommentaryRepairContent } from '../_shared/commentary-context.ts';
import { FeedbackDeadline } from '../_shared/feedback-deadline.ts';
import { rejectedFeedbackDiagnostic } from '../_shared/rejected-feedback.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { ALTHEA_SCORING_PROMPT_VERSION, EVALUATION_SYSTEM_PROMPT } from '../_shared/evaluation-prompts.ts';
import { NURSE_ALTHEA_SIMULATION_PROMPT_ID, NURSE_ALTHEA_SIMULATION_PROMPT_SHA256 } from '../_shared/simulation-prompt.ts';
import { EVIDENCE_PACKET_VERSION, buildEvidencePacket, reconcileEvidence, resolveClosedLoopEvidence, resolveOrderAuthorship, selectAttemptEntries } from '../_shared/althea-evidence-packet.ts';
import { applyLeniencyToEvaluation, readRoomLeniencyMultiplier } from '../_shared/feedback-leniency.ts';
import { canonicalizeEvaluation, hasMeaningfulEvidence, isLearnerAuthoredEvidence, safetyConsistencyErrors, sanitizeSimulationText } from '../_shared/evaluation-scoring.ts';
import { FEEDBACK_RUBRIC_VERSION, CASE_KEY_VERSION, ASSESSMENT_VERSION, formativeNotice, normalizeEvidenceEventIds, resolveCaseEvaluationKey } from '../_shared/feedback-contract.ts';
import { filterTimelineToScoringWindow, renderTimelineEntriesForEvaluation, type EvaluationTimelineEntry } from '../_shared/assignment-timeline.ts';
import { manifestEventToEvaluationEntry } from '../_shared/feedback-manifest.ts';
import { type SourceCoverage } from '../_shared/feedback-coverage.ts';
import { computeFeedbackFingerprint } from '../_shared/feedback-fingerprint.ts';
import { isFeedbackEligibleStatus } from '../_shared/feedback-eligibility.ts';
import { PINNED_FEEDBACK_MODEL } from '../_shared/feedback-model.ts';
import { appendUncitedDeterministicActions } from '../_shared/action-review.ts';
import { FEEDBACK_COMMENT_PROMPT_VERSION, validateFeedbackComments, type AttemptFeedbackComment, type CommentaryResult } from '../_shared/feedback-comments.ts';
import {
  COMMUNICATION_EVALUATION_MAX_COMPLETION_TOKENS,
  MDM_EVALUATION_MAX_COMPLETION_TOKENS,
  COMMENTARY_MAX_COMPLETION_TOKENS,
  assertCompleteEvaluation,
  requestSectionWithLengthRetry,
  mergeEvaluationSections,
  parseSectionCompletion,
  runIndependentFeedbackOperations,
} from '../_shared/feedback-operations.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const sanitizeFeedbackTree = (value: unknown): unknown => {
  if (typeof value === 'string') return sanitizeSimulationText(value);
  if (Array.isArray(value)) return value.map(sanitizeFeedbackTree);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeFeedbackTree(item)]));
  return value;
};

// Single writer for a scored result, shared by fresh grading and saved-score reuse.
// Comments-only reruns never call this, so their scores and safety are untouched.
const scoredAssignmentUpdate = (
  evaluation: ReturnType<typeof canonicalizeEvaluation>,
  debrief: Record<string, unknown>,
  key: { version: string },
  scoringStartAt: string,
  sourceEventIds: string[],
) => {
  const legacy = { summary: evaluation.learning_objectives, clinical_reasoning: { score: evaluation.mdm_score, comments: evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback, strengths: [evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback], areas_for_improvement: evaluation.improvements }, communication_skills: { score: evaluation.communication_score, comments: evaluation.communication_breakdown.closed_loop_team_communication.feedback, strengths: [evaluation.communication_breakdown.focused_information_gathering.feedback], areas_for_improvement: evaluation.improvements }, recommendations: evaluation.recommendations };
  return {
    feedback_status: 'completed',
    feedback_error: null,
    communication_score: evaluation.communication_score,
    mdm_score: evaluation.clinical_reasoning_score,
    communication_breakdown: evaluation.communication_breakdown,
    mdm_breakdown: evaluation.clinical_reasoning_breakdown,
    learning_objectives: evaluation.learning_objectives,
    grade: null,
    nurse_feedback: legacy,
    feedback_generated_at: new Date().toISOString(),
    scoring_start_at: scoringStartAt,
    rubric_version: FEEDBACK_RUBRIC_VERSION,
    case_key_version: key.version || CASE_KEY_VERSION,
    assessment_version: ASSESSMENT_VERSION,
    source_event_ids: sourceEventIds,
    technical_incomplete: false,
    safety_result: evaluation.safety_result,
    feedback_debrief: debrief,
  };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let assignmentId: string | undefined;
  let commentsOnly = false;
  const modelAttempts: ModelTransportAttempt[] = [];
  let incompleteCandidate: unknown;
  let lifecycle: FeedbackDeadline | undefined;
  let failureProvenance: Record<string, unknown> | undefined;
  try {
    const request = await req.json() as { assignmentId?: string; commentsOnly?: boolean; forceRegrade?: boolean };
    assignmentId = request.assignmentId;
    commentsOnly = request.commentsOnly === true;
    const forceRegrade = request.forceRegrade === true;
    if (!assignmentId) throw new Error('Assignment ID is required');
    const deadline = new FeedbackDeadline(90000);
    lifecycle = deadline;
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { global: { fetch: deadline.fetch } });
    const work = async () => {
      const { data: assignment, error: assignmentError } = await client.from('student_room_assignments').select('*, room:room_id (*)').eq('id', assignmentId).single();
      if (assignmentError) throw assignmentError;
      if (!isFeedbackEligibleStatus(assignment.status)) throw new Error('Cannot generate feedback for incomplete assignment');
      const room = (assignment.room ?? {}) as Record<string, unknown>;
      deadline.setPhase('load_manifest');
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
      const scoredEntries = resolveOrderAuthorship(windowEntries.scored);
      const missingTimestampEvents = entries.filter((entry) => entry.timestamp == null);
      const uncertainTimestampEvents = [...missingTimestampEvents, ...windowEntries.uncertain];
      const sourceEventIds = scoredEntries.map((entry) => entry.id);
      const key = resolveCaseEvaluationKey(room);
      const leniencyMultiplier = readRoomLeniencyMultiplier(room);
      const provenance = { assignment_id: assignment.id, attempt_id: assignment.id, rubric_version: FEEDBACK_RUBRIC_VERSION, case_key_version: key.version || CASE_KEY_VERSION, assessment_version: ASSESSMENT_VERSION, scoring_start_at: start?.scoring_start_at ?? null, source_event_ids: sourceEventIds };
      failureProvenance = provenance;
      if (!start) {
        deadline.setPhase('persist_technical_incomplete');
        const result = { technical_incomplete: true, summary: 'This attempt is technically incomplete because no first nurse page was recorded. No learner score was assigned.', formative_notice: formativeNotice };
        const incompleteRun = await client.from('feedback_assessment_runs').insert({ ...provenance, technical_incomplete: true, result }).select('id').single();
        if (incompleteRun.error) throw new Error(incompleteRun.error.message);
        await client.from('student_room_assignments').update({ feedback_status: 'completed', feedback_error: null, scoring_start_at: null, rubric_version: FEEDBACK_RUBRIC_VERSION, case_key_version: key.version || CASE_KEY_VERSION, assessment_version: ASSESSMENT_VERSION, source_event_ids: [], technical_incomplete: true, safety_result: null, feedback_debrief: result, nurse_feedback: result, communication_score: null, mdm_score: null, grade: null, feedback_generated_at: new Date().toISOString() }).eq('id', assignmentId);
        return { runId: incompleteRun.data.id, promptVersion: null };
      }
      if (!hasMeaningfulEvidence(sourceEventIds)) throw new Error('Evidence-bearing attempt produced an empty post-page source event manifest');
      // The manifest RPC succeeded, so every source was read. Zero rows here is an
      // available-empty source, which lets a genuine omission be scored.
      const packet = buildEvidencePacket(scoredEntries, {
        manifestAvailable: true,
        progressNotePresent: Boolean(assignment.student_progress_note?.trim()),
        caseKeyGoalCount: key.goals.length,
      });
      const coverage: SourceCoverage = packet.captureStatus.coverage;
      // Bedside and hint capture covers the whole attempt (activation through completion), so bedside-first
      // events before the first nurse page are still known to the reconciliation check. Scoring stays on the post-page packet.
      const activatedAt = events.find((event) => event.event_type === 'assignment_activated')?.occurred_at;
      const completedAt = events.find((event) => event.event_type === 'assignment_completed')?.occurred_at;
      const attemptEntries = resolveOrderAuthorship(selectAttemptEntries(entries, typeof activatedAt === 'string' ? activatedAt : null, typeof completedAt === 'string' ? completedAt : null));
      const attemptBedsideEventIds = attemptEntries.filter((entry) => entry.kind === 'learner-action' && entry.channel === 'bedside').map((entry) => entry.id);
      const model = PINNED_FEEDBACK_MODEL;
      const inputFingerprint = await computeFeedbackFingerprint({
        attempt_id: assignment.id,
        scoring_start_at: start.scoring_start_at,
        evidence: scoredEntries.map((entry) => ({ id: entry.id, kind: entry.kind, timestamp: entry.timestamp, sequence: entry.sequence ?? null, actor_role: entry.actor_role ?? null, channel: entry.channel ?? null, title: entry.title, body: entry.body ?? null, ordering_ambiguous: entry.ordering_ambiguous ?? false })),
        unordered_event_ids: uncertainTimestampEvents.map((entry) => entry.id),
        coverage: coverage as unknown as Record<string, string>,
        progress_note: assignment.student_progress_note ?? null,
        case_key: key,
        rubric_version: FEEDBACK_RUBRIC_VERSION,
        assessment_version: ASSESSMENT_VERSION,
        model,
        prompt_versions: { evaluation: ALTHEA_SCORING_PROMPT_VERSION, rubric: FEEDBACK_RUBRIC_VERSION, commentary: FEEDBACK_COMMENT_PROMPT_VERSION },
        config: { evidence_packet_version: EVIDENCE_PACKET_VERSION, simulation_prompt_sha256: NURSE_ALTHEA_SIMULATION_PROMPT_SHA256, leniency_multiplier: leniencyMultiplier, communication_max_tokens: COMMUNICATION_EVALUATION_MAX_COMPLETION_TOKENS, mdm_max_tokens: MDM_EVALUATION_MAX_COMPLETION_TOKENS, commentary_max_tokens: COMMENTARY_MAX_COMPLETION_TOKENS },
      });
      deadline.setPhase('fingerprint_and_reuse');
      if (!request.commentsOnly && !forceRegrade) {
        // Identical frozen inputs reuse the saved score. Commentary is part of the
        // saved result, so a comments-only rerun can still refresh it later.
        const { data: priorRuns, error: priorError } = await client.from('feedback_assessment_runs')
          .select('id, result')
          .eq('input_fingerprint', inputFingerprint)
          .eq('technical_incomplete', false)
          .order('created_at', { ascending: false })
          .limit(5);
        if (priorError) throw priorError;
        const reusable = (priorRuns ?? []).find((run) => {
          const saved = run.result as Record<string, any> | null;
          if (!saved?.evaluation || !saved?.debrief || saved?.mode === 'comments_only') return false;
          try { assertCompleteEvaluation(saved.evaluation, saved.debrief.section_errors ?? {}); return true; }
          catch { return false; }
        });
        if (reusable) {
          const saved = reusable.result as { evaluation: ReturnType<typeof canonicalizeEvaluation>; debrief: Record<string, unknown>; comment_prompt_version?: string | null };
          const { error: reuseError } = await client.from('student_room_assignments')
            .update(scoredAssignmentUpdate(saved.evaluation, { ...saved.debrief, reused_from_run_id: reusable.id, input_fingerprint: inputFingerprint }, key, start.scoring_start_at, sourceEventIds))
            .eq('id', assignmentId);
          if (reuseError) throw reuseError;
          return { runId: reusable.id, promptVersion: saved.comment_prompt_version ?? null, reused: true };
        }
      }
      deadline.setPhase('model_evaluation');
      const evidenceManifest = scoredEntries.map((entry) => `${entry.id} | ${entry.kind} | ${entry.title}`).join('\n');
      const allowedEventIds = new Set(sourceEventIds);
      const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY'), fetch: diagnosticFetch(modelAttempts) });
      let commentaryDiagnostic = 'unknown';
      const commentaryAttempts: Array<{ stage: 'initial' | 'repair'; user_content: string; raw_response?: string; error?: string }> = [];
      const commentaryTimeline = renderTimelineEntriesForEvaluation(scoredEntries);
      const commentarySourceCounts = {
        goals: key.goals.length, authored_accepted_approaches: key.acceptable_alternative_paths.length,
        timeline_events: scoredEntries.length, timeline_characters: commentaryTimeline.length,
        note_characters: assignment.student_progress_note?.length ?? 0, evidence_ids: sourceEventIds.length,
      };
      const requestCommentary = async (validationNote = ''): Promise<CommentaryResult | null> => {
        let attempt: (typeof commentaryAttempts)[number] | undefined;
        try {
          const sourceContext = buildCommentaryContext({ goals: key.goals, timeline: commentaryTimeline, note: assignment.student_progress_note, evidenceManifest, validationNote });
          attempt = { stage: 'initial', user_content: sourceContext };
          commentaryAttempts.push(attempt);
          const completion = await deadline.track('commentary_initial', () => openai.chat.completions.create({
            model: PINNED_FEEDBACK_MODEL,
            messages: [{ role: 'system', content: 'Return only the requested JSON object. Do not score or revise the evaluation.' }, { role: 'user', content: sourceContext }],
            response_format: { type: 'json_object' },
            max_completion_tokens: COMMENTARY_MAX_COMPLETION_TOKENS,
          }, { signal: deadline.signal }));
          const rawContent = completion.choices[0].message.content ?? '{}';
          attempt.raw_response = rawContent;
          const parsed = JSON.parse(rawContent);
          const validated = validateFeedbackComments(parsed, allowedEventIds);
          if (validated) return validated;
          commentaryDiagnostic = 'model response failed contract validation';
          console.error('Commentary response failed validation', { response_preview: rawContent.slice(0, 1200), valid_event_count: allowedEventIds.size });
          const repairContent = buildCommentaryRepairContent(sourceContext, rawContent);
          attempt = { stage: 'repair', user_content: repairContent };
          commentaryAttempts.push(attempt);
          const repair = await deadline.track('commentary_repair', () => openai.chat.completions.create({
            model: PINNED_FEEDBACK_MODEL,
            messages: [
              { role: 'system', content: 'Repair the candidate into the exact requested JSON contract. Return JSON only. Do not invent evidence IDs or actions.' },
              { role: 'user', content: repairContent },
            ],
            response_format: { type: 'json_object' },
            max_completion_tokens: COMMENTARY_MAX_COMPLETION_TOKENS,
          }, { signal: deadline.signal }));
          const repairedContent = repair.choices[0].message.content ?? '{}';
          attempt.raw_response = repairedContent;
          return validateFeedbackComments(JSON.parse(repairedContent), allowedEventIds);
        } catch (error) {
          commentaryDiagnostic = error instanceof Error ? error.message : String(error);
          if (attempt) attempt.error = commentaryDiagnostic;
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
        // Comments-only reruns are checked against the same packet as a full run.
        const commentErrors = reconcileEvidence({ packet, bedsideEventIds: attemptBedsideEventIds, texts: [...commentary.comments.strengths, ...commentary.comments.improvements].map((comment) => comment.text), componentEvidenceIds: [], commentEvidenceIds: [...commentary.comments.strengths, ...commentary.comments.improvements].flatMap((comment) => comment.evidence_event_ids) });
        if (commentErrors.length) throw new Error(`Evidence reconciliation failed; prior feedback was preserved (${commentErrors.join('; ')})`);
        const priorDebrief = assignment.feedback_debrief && typeof assignment.feedback_debrief === 'object' && !Array.isArray(assignment.feedback_debrief) ? assignment.feedback_debrief as Record<string, unknown> : {};
        const debrief = { ...priorDebrief, strengths: commentary.comments.strengths, improvements: commentary.comments.improvements, comment_generation_status: commentary.status, comment_prompt_version: commentary.prompt_version, comment_evidence_event_ids: [...new Set([...commentary.comments.strengths, ...commentary.comments.improvements].flatMap((comment) => comment.evidence_event_ids))] };
        const run = await client.from('feedback_assessment_runs').insert({ assignment_id: assignment.id, attempt_id: assignment.id, rubric_version: assignment.rubric_version, case_key_version: assignment.case_key_version, assessment_version: assignment.assessment_version, scoring_start_at: assignment.scoring_start_at, source_event_ids: assignment.source_event_ids ?? sourceEventIds, technical_incomplete: Boolean(assignment.technical_incomplete), result: { mode: 'comments_only', debrief, comment_prompt_version: commentary.prompt_version } }).select('id').single();
        if (run.error) throw run.error;
        const { error: updateError } = await client.from('student_room_assignments').update({ feedback_status: 'completed', feedback_error: null, feedback_generated_at: new Date().toISOString(), feedback_debrief: debrief }).eq('id', assignmentId);
        if (updateError) throw updateError;
        return { runId: run.data.id, promptVersion: commentary.prompt_version };
      }
      const prompt = `SCORING VERSION: ${FEEDBACK_RUBRIC_VERSION} (${ALTHEA_SCORING_PROMPT_VERSION})\n\nFORMATIVE NOTICE: ${formativeNotice}\n\nCASE-SPECIFIC EVALUATION KEY (${key.version}; guide only, not evidence):\n${JSON.stringify(key, null, 2)}\n\nSCORING BOUNDARY: score only learner actions at or after ${start.scoring_start_at}. Baseline chart context and prior/setup events are excluded.\n\nSCORABLE POST-PAGE EVIDENCE IDS:\n${evidenceManifest}\n\nCURRENT ATTEMPT EVIDENCE (${sourceEventIds.length} timestamped events; actor_role/channel are structured fields):\n${renderTimelineEntriesForEvaluation(scoredEntries)}\n\nEVENTS WITH MISSING OR AMBIGUOUS ORDERING (preserve as uncertainty; do not use to infer in-window action, delay, or omission):\n${uncertainTimestampEvents.map((entry) => JSON.stringify({ id: entry.id, occurred_at: entry.timestamp, sequence: entry.sequence ?? null, ordering_ambiguous: true, kind: entry.kind, title: entry.title, actor_role: entry.actor_role, channel: entry.channel, excerpt: entry.body ?? null })).join('\\n') || 'None.'}\n\nSOURCE COVERAGE (explicit; available_empty = the source was read successfully and returned zero rows, which is a complete empty source; unavailable = could not be read, so dependent components must be not scored):\n${JSON.stringify(coverage, null, 2)}\n\nProgress note: ${assignment.student_progress_note || 'Not observed'}`;
      const requestEvaluationSection = async (sectionInstructions: string, maxCompletionTokens: number) => {
        return requestSectionWithLengthRetry(async (budget) => {
          const completion = await openai.chat.completions.create({
            model: PINNED_FEEDBACK_MODEL,
            messages: [
              { role: 'system', content: EVALUATION_SYSTEM_PROMPT },
              { role: 'user', content: `${prompt}\n\nOUTPUT FORMAT ONLY: Return one JSON object. Every requested rubric component must be {score: integer|null, feedback: string, evidence_event_ids: string[], not_scored_reason: string|null}. Null requires a concrete reason. Include an explanation and evidence for an actual efficiency/safety deduction; use score 0 only when the respective absence/interference finding is assessable. Do not include rubric components assigned to the other section.\n\n${sectionInstructions}` },
            ],
            response_format: { type: 'json_object' },
            max_completion_tokens: budget,
          }, { signal: deadline.signal });
          return parseSectionCompletion(completion);
        }, maxCompletionTokens);
      };
      const requestCommunicationEvaluation = () => requestEvaluationSection(
        'COMMUNICATION SECTION: Return communication_breakdown containing focused_information_gathering (0-2), closed_loop_team_communication (0-3), and efficiency_deduction (-2..0). Apply the Communication anchors from the rubric. Return no scores or fields for Medical Decision-Making.',
        COMMUNICATION_EVALUATION_MAX_COMPLETION_TOKENS,
      );
      const requestMdmEvaluation = () => requestEvaluationSection(
        'MEDICAL DECISION-MAKING SECTION: Return clinical_reasoning_breakdown containing orders_monitoring_quality (0-3), clinical_reasoning_documentation (0-2), and safety_deduction (0/-1/-2), plus safety_result {level: none|concern|critical|not_assessed, action: string|null, rationale: string|null, evidence_event_ids: string[]}. Also return learning_objectives, strengths, improvements, recommendations, and action_review. Apply the Medical Decision-Making anchors from the rubric. Do not return communication scores or components.',
        MDM_EVALUATION_MAX_COMPLETION_TOKENS,
      );
      // Collect section diagnostics, then reject any technical incompleteness
      // before persistence; a partial model response is not a successful assessment.
      const sectionErrors: Record<string, string> = {};
      const guardSection = (label: string, request: () => Promise<Record<string, unknown>>) => request().catch((error) => {
        sectionErrors[label] = error instanceof Error ? error.message : String(error);
        return {} as Record<string, unknown>;
      });
      const [communicationRaw, mdmRaw, commentary] = await runIndependentFeedbackOperations(
        () => guardSection('communication', () => deadline.track('communication', requestCommunicationEvaluation)),
        () => guardSection('medical_decision_making', () => deadline.track('medical_decision_making', requestMdmEvaluation)),
        requestCommentary,
      );
      deadline.setPhase('validation');
      if (sectionErrors.communication && sectionErrors.medical_decision_making) {
        incompleteCandidate = { communicationRaw, mdmRaw, sectionErrors };
        throw new Error(`Evaluation failed for both sections: ${JSON.stringify(sectionErrors)}`);
      }
      const mergedEvaluation = mergeEvaluationSections(communicationRaw, mdmRaw);
      // Room modifier (RoomEditor leniency multiplier) is applied to component scores
      // before totals are recomputed; safety stays unscaled and is reported separately.
      const evaluation = applyLeniencyToEvaluation(canonicalizeEvaluation(mergedEvaluation), leniencyMultiplier);
      try { assertCompleteEvaluation(evaluation, sectionErrors); }
      catch (error) {
        incompleteCandidate = { evaluation, mergedEvaluation, communicationRaw, mdmRaw, sectionErrors };
        throw error;
      }
      const actionReview = sanitizeFeedbackTree(mergedEvaluation.action_review ?? []);
      // Commentary is separate from scoring. A commentary failure keeps the valid
      // grades and records a visible commentary error instead of discarding them.
      // Validation failures collected for this run; any entry keeps the prior saved result.
      const validationErrors: string[] = [];
      const commentaryGenerated = commentary?.status === 'generated';
      const generatedComments: { strengths: AttemptFeedbackComment[]; improvements: AttemptFeedbackComment[] } = commentary?.status === 'generated'
        ? commentary.comments
        : { strengths: [], improvements: [] };
      const commentStatus = commentary?.status ?? 'failed';
      const commentPromptVersion = FEEDBACK_COMMENT_PROMPT_VERSION;
      if (!commentaryGenerated) validationErrors.push(`commentary did not produce exactly two strengths and two improvements (${commentary?.status === 'insufficient_evidence' ? commentary.explanation : commentaryDiagnostic})`);
      const commentError = commentaryGenerated
        ? null
        : commentary?.status === 'insufficient_evidence'
          ? `Commentary insufficient evidence: ${commentary.explanation}`
          : `Commentary generation failed validation (${commentaryDiagnostic}).`;
      const idsForKinds = (kinds: string[], learnerOnly = false) => scoredEntries
        .filter((entry) => kinds.includes(entry.kind))
        .filter((entry) => !learnerOnly || isLearnerAuthoredEvidence(entry))
        .map((entry) => entry.id);
      const learnerCommunicationIds = idsForKinds(['message', 'consultant-message', 'learner-action'], true);
      // Closed-loop candidates come from the same packet the scorer read. Learner nurse-chat
      // requests are closed-loop evidence; the earlier list omitted them, so every request
      // was dropped and the score went out with no linked evidence.
      const learnerClosedLoopIds = packet.closedLoopEventIds.filter((id) => sourceEventIds.includes(id));
      const learnerReasoningIds = idsForKinds(['progress-note', 'message', 'consultant-message', 'order', 'labs', 'vital', 'imaging'], true);
      // Order credit: observed or inferred learner orders only; unknown-author orders are never credited.
      const orderCreditIds = scoredEntries.filter((entry) => entry.kind === 'order' ? (entry.authorship === 'observed' || entry.authorship === 'inferred') : ['labs', 'vital', 'imaging'].includes(entry.kind)).map((entry) => entry.id);
      const evidence = {
        communication: {
          focused: normalizeEvidenceEventIds(evaluation.communication_breakdown.focused_information_gathering.evidence_event_ids, learnerCommunicationIds),
          closedLoop: normalizeEvidenceEventIds(evaluation.communication_breakdown.closed_loop_team_communication.evidence_event_ids, learnerClosedLoopIds),
        },
        mdm: {
          orders: normalizeEvidenceEventIds(evaluation.mdm_breakdown.orders_monitoring_quality.evidence_event_ids, orderCreditIds),
          reasoning: normalizeEvidenceEventIds(evaluation.mdm_breakdown.clinical_reasoning_documentation.evidence_event_ids, learnerReasoningIds),
        },
      };
      if (!evaluation.communication_breakdown.focused_information_gathering.evidence_event_ids.length && evaluation.communication_breakdown.focused_information_gathering.score != null) evidence.communication.focused = learnerCommunicationIds;
      const closedLoopResolution = resolveClosedLoopEvidence({
        requestedIds: evaluation.communication_breakdown.closed_loop_team_communication.evidence_event_ids,
        score: evaluation.communication_breakdown.closed_loop_team_communication.score,
        candidateIds: learnerClosedLoopIds,
        pairs: packet.requestAcknowledgmentPairs,
        sourceEventIds,
      });
      if (closedLoopResolution.error) validationErrors.push(closedLoopResolution.error);
      else evidence.communication.closedLoop = closedLoopResolution.evidenceIds;
      if (!evaluation.mdm_breakdown.orders_monitoring_quality.evidence_event_ids.length && evaluation.mdm_breakdown.orders_monitoring_quality.score != null) evidence.mdm.orders = orderCreditIds;
      if (!evaluation.mdm_breakdown.clinical_reasoning_documentation.evidence_event_ids.length && evaluation.mdm_breakdown.clinical_reasoning_documentation.score != null) evidence.mdm.reasoning = learnerReasoningIds;
      evaluation.communication_breakdown.focused_information_gathering.evidence_event_ids = evidence.communication.focused;
      evaluation.communication_breakdown.closed_loop_team_communication.evidence_event_ids = evidence.communication.closedLoop;
      evaluation.communication_breakdown.efficiency_deduction.evidence_event_ids = normalizeEvidenceEventIds(evaluation.communication_breakdown.efficiency_deduction.evidence_event_ids, sourceEventIds);
      evaluation.mdm_breakdown.orders_monitoring_quality.evidence_event_ids = evidence.mdm.orders;
      evaluation.mdm_breakdown.clinical_reasoning_documentation.evidence_event_ids = evidence.mdm.reasoning;
      evaluation.mdm_breakdown.safety_deduction.evidence_event_ids = normalizeEvidenceEventIds(evaluation.mdm_breakdown.safety_deduction.evidence_event_ids, sourceEventIds);
      evaluation.safety_result.evidence_event_ids = normalizeEvidenceEventIds(evaluation.safety_result.evidence_event_ids, sourceEventIds);
      // Reconciliation gate: scores, explanations, and comments must agree with the packet before anything is saved.
      const reconciliationErrors = reconcileEvidence({
        packet,
        bedsideEventIds: attemptBedsideEventIds,
        texts: [
          evaluation.learning_objectives,
          ...Object.values(evaluation.communication_breakdown).map((component) => component.feedback),
          ...Object.values(evaluation.clinical_reasoning_breakdown).map((component) => component.feedback),
          evaluation.safety_result.rationale ?? '',
          evaluation.safety_result.action ?? '',
          ...generatedComments.strengths.map((comment) => comment.text),
          ...generatedComments.improvements.map((comment) => comment.text),
        ].filter((text): text is string => typeof text === 'string' && text.length > 0),
        componentEvidenceIds: [...Object.values(evaluation.communication_breakdown), ...Object.values(evaluation.clinical_reasoning_breakdown)].flatMap((component) => component.evidence_event_ids),
        commentEvidenceIds: [...generatedComments.strengths, ...generatedComments.improvements].flatMap((comment) => comment.evidence_event_ids),
      });
      const allValidationErrors = [...validationErrors, ...safetyConsistencyErrors(evaluation), ...reconciliationErrors];
      if (allValidationErrors.length) {
        // Requires rejected_feedback_diagnostics RLS migration before deployment.
        const diagnostic = rejectedFeedbackDiagnostic({ evaluation, generatedComments, mergedEvaluation, sectionErrors, commentaryResult: commentary, commentaryAttempts, commentarySourceCounts, model_transport: modelAttempts }, allValidationErrors);
        const retained = await client.from('feedback_assessment_runs').insert({ ...provenance, technical_incomplete: true, input_fingerprint: inputFingerprint, result: diagnostic });
        const retentionError = retained.error ? '; diagnostic retention failed' : '';
        throw new Error(`Evidence reconciliation failed; the prior saved result was kept (${allValidationErrors.join('; ')}${retentionError})`);
      }
      const deterministicEntries = scoredEntries.filter((entry) => (entry.kind === 'order' ? entry.authorship === 'observed' || entry.authorship === 'inferred' : ['labs', 'imaging'].includes(entry.kind)));
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
      const debrief = { leniency_multiplier: leniencyMultiplier, prompt_id: NURSE_ALTHEA_SIMULATION_PROMPT_ID, prompt_sha256: NURSE_ALTHEA_SIMULATION_PROMPT_SHA256, evidence_packet: { version: packet.version, learner_communication_event_ids: packet.learnerCommunicationEventIds, closed_loop_event_ids: packet.closedLoopEventIds, request_acknowledgment_pairs: packet.requestAcknowledgmentPairs, learner_order_event_ids: packet.learnerOrderEventIds, observed_order_event_ids: packet.observedOrderEventIds, inferred_order_event_ids: packet.inferredOrderEventIds, unknown_order_event_ids: packet.unknownOrderEventIds, learner_action_event_ids: packet.learnerActionEventIds, consult_event_ids: packet.consultEventIds, bedside_event_ids: attemptBedsideEventIds, hint_event_ids: packet.hintEventIds, baseline_medications_and_orders: packet.baselineMedicationsAndOrders }, case_goals: key.goals, approach_summary: evaluation.learning_objectives, strengths: generatedComments.strengths, improvements: generatedComments.improvements, recommendations: evaluation.recommendations, growth_areas: growthAreas, action_review: actionReviewWithKey, safety_result: evaluation.safety_result, scoring_start_at: start.scoring_start_at, comment_generation_status: commentStatus, comment_prompt_version: commentPromptVersion, comment_error: commentError, section_errors: sectionErrors, source_coverage: coverage, input_fingerprint: inputFingerprint, evaluation_version: FEEDBACK_RUBRIC_VERSION, assessment_version: ASSESSMENT_VERSION, case_key_version: key.version || CASE_KEY_VERSION };
      deadline.setPhase('persist_scored_result');
      const run = await client.from('feedback_assessment_runs').insert({ ...provenance, technical_incomplete: false, input_fingerprint: inputFingerprint, result: { evaluation, debrief, comment_prompt_version: commentPromptVersion, comment_generation_status: commentStatus, comment_error: commentError } }).select('id').single();
      if (run.error) throw run.error;
      const { error: updateError } = await client.from('student_room_assignments').update(scoredAssignmentUpdate(evaluation, debrief, key, start.scoring_start_at, sourceEventIds)).eq('id', assignmentId);
      if (updateError) throw updateError;
      return { runId: run.data.id, promptVersion: commentPromptVersion, commentError };
    };
    const result = await deadline.run(work) as { runId?: string | null; promptVersion?: string | null };
    return new Response(JSON.stringify({ success: true, assignmentId, ...result }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : (error && typeof error === 'object' && 'message' in error ? String(error.message) : JSON.stringify(error));
    console.error('Feedback generation failed', { assignmentId, error: message });
    if (assignmentId && !commentsOnly) {
      // Diagnostic/status reporting has its own bounded transport after scoring is cancelled.
      const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
        global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
      });
      if ((lifecycle?.timedOut || incompleteCandidate) && failureProvenance) {
        const retained = await client.from('feedback_assessment_runs').insert({
          ...failureProvenance, technical_incomplete: true,
          result: { status: 'rejected', failure_type: lifecycle?.timedOut ? 'timeout' : 'completeness', errors: [message], timing: lifecycle?.snapshot(), candidate: incompleteCandidate, model_transport: JSON.parse(JSON.stringify(modelAttempts)) },
        });
        if (retained.error) console.error('Timeout diagnostic retention failed', { assignmentId, code: retained.error.code });
      }
      await client.from('student_room_assignments').update({ feedback_status: 'failed', feedback_error: message }).eq('id', assignmentId);
    }
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
