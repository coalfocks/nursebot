import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { ALTHEA_SCORING_PROMPT_VERSION, EVALUATION_SYSTEM_PROMPT } from '../_shared/evaluation-prompts.ts';
import { NURSE_ALTHEA_SIMULATION_PROMPT_ID, NURSE_ALTHEA_SIMULATION_PROMPT_SHA256 } from '../_shared/simulation-prompt.ts';
import { EVIDENCE_PACKET_VERSION, applyBedsideRuleToEvaluation, buildEvidencePacket, reconcileEvidence, renderPacketSummaryForPrompt, resolveBedsideExpectation } from '../_shared/althea-evidence-packet.ts';
import { applyLeniencyToEvaluation, readRoomLeniencyMultiplier } from '../_shared/feedback-leniency.ts';
import { canonicalizeEvaluation, hasMeaningfulEvidence, isLearnerAuthoredEvidence, sanitizeSimulationText } from '../_shared/evaluation-scoring.ts';
import { FEEDBACK_RUBRIC_VERSION, CASE_KEY_VERSION, ASSESSMENT_VERSION, formativeNotice, normalizeEvidenceEventIds, resolveCaseEvaluationKey } from '../_shared/feedback-contract.ts';
import { filterTimelineToScoringWindow, renderTimelineEntriesForEvaluation, type EvaluationTimelineEntry } from '../_shared/assignment-timeline.ts';
import { manifestEventToEvaluationEntry } from '../_shared/feedback-manifest.ts';
import { type SourceCoverage } from '../_shared/feedback-coverage.ts';
import { computeFeedbackFingerprint } from '../_shared/feedback-fingerprint.ts';
import { isFeedbackEligibleStatus } from '../_shared/feedback-eligibility.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';
import { appendUncitedDeterministicActions } from '../_shared/action-review.ts';
import { FEEDBACK_COMMENT_PROMPT, FEEDBACK_COMMENT_PROMPT_VERSION, validateFeedbackComments, type AttemptFeedbackComment, type CommentaryResult } from '../_shared/feedback-comments.ts';
import {
  COMMUNICATION_EVALUATION_MAX_COMPLETION_TOKENS,
  MDM_EVALUATION_MAX_COMPLETION_TOKENS,
  COMMENTARY_MAX_COMPLETION_TOKENS,
  mergeEvaluationSections,
  parseSectionCompletion,
  runIndependentFeedbackOperations,
} from '../_shared/feedback-operations.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('Evaluation scoring timed out')), ms));
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
  try {
    const request = await req.json() as { assignmentId?: string; commentsOnly?: boolean; forceRegrade?: boolean };
    assignmentId = request.assignmentId;
    commentsOnly = request.commentsOnly === true;
    const forceRegrade = request.forceRegrade === true;
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
      const leniencyMultiplier = readRoomLeniencyMultiplier(room);
      const bedsideConfig = resolveBedsideExpectation(room);
      const provenance = { assignment_id: assignment.id, attempt_id: assignment.id, rubric_version: FEEDBACK_RUBRIC_VERSION, case_key_version: key.version || CASE_KEY_VERSION, assessment_version: ASSESSMENT_VERSION, scoring_start_at: start?.scoring_start_at ?? null, source_event_ids: sourceEventIds };
      if (!start) {
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
      const model = getOpenAIModel('generate_feedback');
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
        config: { evidence_packet_version: EVIDENCE_PACKET_VERSION, bedside_expectation: bedsideConfig, leniency_multiplier: leniencyMultiplier, communication_max_tokens: COMMUNICATION_EVALUATION_MAX_COMPLETION_TOKENS, mdm_max_tokens: MDM_EVALUATION_MAX_COMPLETION_TOKENS, commentary_max_tokens: COMMENTARY_MAX_COMPLETION_TOKENS },
      });
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
          return Boolean(saved?.evaluation && saved?.debrief && saved?.mode !== 'comments_only');
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
      const evidenceManifest = scoredEntries.map((entry) => `${entry.id} | ${entry.kind} | ${entry.title}`).join('\n');
      const allowedEventIds = new Set(sourceEventIds);
      const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
      let commentaryDiagnostic = 'unknown';
      const requestCommentary = async (validationNote = ''): Promise<CommentaryResult | null> => {
        try {
          const completion = await openai.chat.completions.create({
            model: getOpenAIModel('generate_feedback'),
            messages: [{ role: 'system', content: 'Return only the requested JSON object. Do not score or revise the evaluation.' }, { role: 'user', content: `${FEEDBACK_COMMENT_PROMPT}\n\nCASE GOALS:\n${key.goals.join('\n') || 'Not recorded.'}\n\n${renderPacketSummaryForPrompt(packet)}\n\nVERIFIED ATTEMPT TIMELINE:\n${renderTimelineEntriesForEvaluation(scoredEntries)}\n\nLEARNER NOTE:\n${assignment.student_progress_note || 'Not observed.'}\n\nVALID EVIDENCE IDS:\n${evidenceManifest}${validationNote}` }],
            response_format: { type: 'json_object' },
            max_completion_tokens: COMMENTARY_MAX_COMPLETION_TOKENS,
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
            max_completion_tokens: COMMENTARY_MAX_COMPLETION_TOKENS,
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
        // Comments-only reruns are checked against the same packet as a full run.
        const commentErrors = reconcileEvidence({ packet, texts: [...commentary.comments.strengths, ...commentary.comments.improvements].map((comment) => comment.text), componentEvidenceIds: [], commentEvidenceIds: [...commentary.comments.strengths, ...commentary.comments.improvements].flatMap((comment) => comment.evidence_event_ids) });
        if (commentErrors.length) throw new Error(`Evidence reconciliation failed; prior feedback was preserved (${commentErrors.join('; ')})`);
        const priorDebrief = assignment.feedback_debrief && typeof assignment.feedback_debrief === 'object' && !Array.isArray(assignment.feedback_debrief) ? assignment.feedback_debrief as Record<string, unknown> : {};
        const debrief = { ...priorDebrief, strengths: commentary.comments.strengths, improvements: commentary.comments.improvements, comment_generation_status: commentary.status, comment_prompt_version: commentary.prompt_version, comment_evidence_event_ids: [...new Set([...commentary.comments.strengths, ...commentary.comments.improvements].flatMap((comment) => comment.evidence_event_ids))] };
        const run = await client.from('feedback_assessment_runs').insert({ assignment_id: assignment.id, attempt_id: assignment.id, rubric_version: assignment.rubric_version, case_key_version: assignment.case_key_version, assessment_version: assignment.assessment_version, scoring_start_at: assignment.scoring_start_at, source_event_ids: assignment.source_event_ids ?? sourceEventIds, technical_incomplete: Boolean(assignment.technical_incomplete), result: { mode: 'comments_only', debrief, comment_prompt_version: commentary.prompt_version } }).select('id').single();
        if (run.error) throw run.error;
        const { error: updateError } = await client.from('student_room_assignments').update({ feedback_status: 'completed', feedback_error: null, feedback_generated_at: new Date().toISOString(), feedback_debrief: debrief }).eq('id', assignmentId);
        if (updateError) throw updateError;
        return { runId: run.data.id, promptVersion: commentary.prompt_version };
      }
      const prompt = `SCORING VERSION: ${FEEDBACK_RUBRIC_VERSION} (${ALTHEA_SCORING_PROMPT_VERSION})\n\nFORMATIVE NOTICE: ${formativeNotice}\n\nCASE-SPECIFIC EVALUATION KEY (${key.version}; guide only, not evidence):\n${JSON.stringify(key, null, 2)}\n\nSCORING BOUNDARY: score only learner actions at or after ${start.scoring_start_at}. Baseline chart context and prior/setup events are excluded.\n\nSCORABLE POST-PAGE EVIDENCE IDS:\n${evidenceManifest}\n\n${renderPacketSummaryForPrompt(packet)}\n\nCURRENT ATTEMPT EVIDENCE (${sourceEventIds.length} timestamped events; actor_role/channel are structured fields):\n${renderTimelineEntriesForEvaluation(scoredEntries)}\n\nEVENTS WITH MISSING OR AMBIGUOUS ORDERING (preserve as uncertainty; do not use to infer in-window action, delay, or omission):\n${uncertainTimestampEvents.map((entry) => JSON.stringify({ id: entry.id, occurred_at: entry.timestamp, sequence: entry.sequence ?? null, ordering_ambiguous: true, kind: entry.kind, title: entry.title, actor_role: entry.actor_role, channel: entry.channel, excerpt: entry.body ?? null })).join('\\n') || 'None.'}\n\nSOURCE COVERAGE (explicit; available_empty = the source was read successfully and returned zero rows, which is a complete empty source; unavailable = could not be read, so dependent components must be not scored):\n${JSON.stringify(coverage, null, 2)}\n\nProgress note: ${assignment.student_progress_note || 'Not observed'}`;
      const requestEvaluationSection = async (sectionInstructions: string, maxCompletionTokens: number) => {
        const completion = await openai.chat.completions.create({
          model: getOpenAIModel('generate_feedback'),
          messages: [
            { role: 'system', content: EVALUATION_SYSTEM_PROMPT },
            { role: 'user', content: `${prompt}\n\nOUTPUT FORMAT ONLY: Return one JSON object. Every requested rubric component must be {score: integer|null, feedback: string, evidence_event_ids: string[], not_scored_reason: string|null}. Null requires a concrete reason. Include an explanation and evidence for an actual efficiency/safety deduction; use score 0 only when the respective absence/interference finding is assessable. Do not include rubric components assigned to the other section.\n\n${sectionInstructions}` },
          ],
          response_format: { type: 'json_object' },
          max_completion_tokens: maxCompletionTokens,
        });
        return parseSectionCompletion(completion);
      };
      const requestCommunicationEvaluation = () => requestEvaluationSection(
        'COMMUNICATION SECTION: Return communication_breakdown containing focused_information_gathering (0-2), closed_loop_team_communication (0-3), and efficiency_deduction (-2..0). Apply the Communication anchors from the rubric. Return no scores or fields for Medical Decision-Making.',
        COMMUNICATION_EVALUATION_MAX_COMPLETION_TOKENS,
      );
      const requestMdmEvaluation = () => requestEvaluationSection(
        'MEDICAL DECISION-MAKING SECTION: Return clinical_reasoning_breakdown containing orders_monitoring_quality (0-3), clinical_reasoning_documentation (0-2), and safety_deduction (0/-1/-2), plus safety_result {level: none|concern|critical|not_assessed, action: string|null, rationale: string|null, evidence_event_ids: string[]}. Also return learning_objectives, strengths, improvements, recommendations, and action_review. Apply the Medical Decision-Making anchors from the rubric. Do not return communication scores or components.',
        MDM_EVALUATION_MAX_COMPLETION_TOKENS,
      );
      // A failed section becomes missing evidence for its own components only; the
      // other section's valid scores are kept. If both sections fail, nothing valid
      // exists and the attempt keeps its prior saved result.
      const sectionErrors: Record<string, string> = {};
      const guardSection = (label: string, request: () => Promise<Record<string, unknown>>) => request().catch((error) => {
        sectionErrors[label] = error instanceof Error ? error.message : String(error);
        return {} as Record<string, unknown>;
      });
      const [communicationRaw, mdmRaw, commentary] = await runIndependentFeedbackOperations(
        () => guardSection('communication', requestCommunicationEvaluation),
        () => guardSection('medical_decision_making', requestMdmEvaluation),
        requestCommentary,
      );
      if (sectionErrors.communication && sectionErrors.medical_decision_making) {
        throw new Error(`Evaluation failed for both sections: ${JSON.stringify(sectionErrors)}`);
      }
      const mergedEvaluation = mergeEvaluationSections(communicationRaw, mdmRaw);
      // Room modifier (RoomEditor leniency multiplier) is applied to component scores
      // before totals are recomputed; safety stays unscaled and is reported separately.
      // Room leniency first, then the bedside rule, so the one-point adjustment is exact and totals are recomputed.
      const bedsideRuled = applyBedsideRuleToEvaluation(applyLeniencyToEvaluation(canonicalizeEvaluation(mergedEvaluation), leniencyMultiplier), packet, bedsideConfig);
      const evaluation = bedsideRuled.evaluation;
      const bedsideRuleResult = bedsideRuled.result;
      const actionReview = sanitizeFeedbackTree(mergedEvaluation.action_review ?? []);
      // Commentary is separate from scoring. A commentary failure keeps the valid
      // grades and records a visible commentary error instead of discarding them.
      const commentaryGenerated = commentary?.status === 'generated';
      const generatedComments: { strengths: AttemptFeedbackComment[]; improvements: AttemptFeedbackComment[] } = commentary?.status === 'generated'
        ? commentary.comments
        : { strengths: [], improvements: [] };
      const commentStatus = commentary?.status ?? 'failed';
      const commentPromptVersion = FEEDBACK_COMMENT_PROMPT_VERSION;
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
      // Reconciliation gate: scores, explanations, and comments must agree with the packet before anything is saved.
      const reconciliationErrors = reconcileEvidence({
        packet,
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
      if (reconciliationErrors.length) throw new Error(`Evidence reconciliation failed; the prior saved result was kept (${reconciliationErrors.join('; ')})`);
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
      const debrief = { leniency_multiplier: leniencyMultiplier, prompt_id: NURSE_ALTHEA_SIMULATION_PROMPT_ID, prompt_sha256: NURSE_ALTHEA_SIMULATION_PROMPT_SHA256, evidence_packet: { version: packet.version, bedside_expectation: bedsideConfig, bedside_rule: bedsideRuleResult, learner_communication_event_ids: packet.learnerCommunicationEventIds, bedside_event_ids: packet.bedsideEventIds, hint_event_ids: packet.hintEventIds, baseline_medications_and_orders: packet.baselineMedicationsAndOrders, capture_status: packet.captureStatus.bedside }, case_goals: key.goals, approach_summary: evaluation.learning_objectives, strengths: generatedComments.strengths, improvements: generatedComments.improvements, recommendations: evaluation.recommendations, growth_areas: growthAreas, action_review: actionReviewWithKey, safety_result: evaluation.safety_result, scoring_start_at: start.scoring_start_at, comment_generation_status: commentStatus, comment_prompt_version: commentPromptVersion, comment_error: commentError, section_errors: sectionErrors, source_coverage: coverage, input_fingerprint: inputFingerprint, evaluation_version: FEEDBACK_RUBRIC_VERSION, assessment_version: ASSESSMENT_VERSION, case_key_version: key.version || CASE_KEY_VERSION };
      const run = await client.from('feedback_assessment_runs').insert({ ...provenance, technical_incomplete: false, input_fingerprint: inputFingerprint, result: { evaluation, debrief, comment_prompt_version: commentPromptVersion, comment_generation_status: commentStatus, comment_error: commentError } }).select('id').single();
      if (run.error) throw run.error;
      const { error: updateError } = await client.from('student_room_assignments').update(scoredAssignmentUpdate(evaluation, debrief, key, start.scoring_start_at, sourceEventIds)).eq('id', assignmentId);
      if (updateError) throw updateError;
      return { runId: run.data.id, promptVersion: commentPromptVersion, commentError };
    })();
    const result = await Promise.race([work, timeout(90000)]) as { runId?: string | null; promptVersion?: string | null };
    return new Response(JSON.stringify({ success: true, assignmentId, ...result }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : (error && typeof error === 'object' && 'message' in error ? String(error.message) : JSON.stringify(error));
    if (assignmentId && !commentsOnly) { const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''); await client.from('student_room_assignments').update({ feedback_status: 'failed', feedback_error: message }).eq('id', assignmentId); }
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
