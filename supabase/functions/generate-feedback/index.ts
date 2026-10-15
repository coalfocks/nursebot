import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { EVALUATION_SYSTEM_PROMPT, CANONICAL_RUBRIC } from '../_shared/evaluation-prompts.ts';
import { canonicalizeEvaluation, type EvaluationScoringResponse } from '../_shared/evaluation-scoring.ts';
import { FEEDBACK_RUBRIC_VERSION, CASE_KEY_VERSION, ASSESSMENT_VERSION, deriveScoringStart, formativeNotice, resolveCaseEvaluationKey } from '../_shared/feedback-contract.ts';
import { buildAssignmentTimelineEntries, renderTimelineEntriesForEvaluation, type TimelineImagingRow, type TimelineLabRow, type TimelineOrderRow, type TimelineVitalRow } from '../_shared/assignment-timeline.ts';
import { isFeedbackEligibleStatus } from '../_shared/feedback-eligibility.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('Evaluation scoring timed out')), ms));

const lineage = async (client: ReturnType<typeof createClient>, roomId: number) => {
  const result: number[] = []; const seen = new Set<number>(); let current: number | null = roomId;
  while (current && !seen.has(current)) { seen.add(current); result.push(current); const { data, error } = await client.from('rooms').select('continues_from').eq('id', current).maybeSingle(); if (error) throw error; current = data?.continues_from ?? null; }
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
      const room = (assignment.room ?? {}) as Record<string, unknown>;
      const { data: messages, error: messageError } = await client.from('chat_messages').select('id, assignment_id, role, content, created_at').eq('assignment_id', assignmentId).order('created_at', { ascending: true });
      if (messageError) throw messageError;
      const start = deriveScoringStart(messages ?? []);
      const roomId = Number(assignment.room_id);
      const patientId = typeof room.patient_id === 'string' ? room.patient_id : null;
      const [ordersRes, labsRes, vitalsRes, imagingRes] = patientId ? await Promise.all([
        client.from('medical_orders').select('id, assignment_id, room_id, override_scope, category, order_name, dose, route, frequency, priority, status, instructions, order_time, created_at, deleted_at').eq('patient_id', patientId).is('deleted_at', null),
        client.from('lab_results').select('id, assignment_id, room_id, override_scope, test_name, value, unit, status, collection_time, result_time, created_at, deleted_at').eq('patient_id', patientId).is('deleted_at', null),
        client.from('vital_signs').select('id, assignment_id, room_id, override_scope, timestamp, temperature, blood_pressure_systolic, blood_pressure_diastolic, heart_rate, respiratory_rate, oxygen_saturation, pain, deleted_at').eq('patient_id', patientId).is('deleted_at', null),
        client.from('imaging_studies').select('id, assignment_id, room_id, override_scope, order_name, study_type, status, report, order_time, report_generated_at, created_at, deleted_at').eq('patient_id', patientId).is('deleted_at', null),
      ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
      for (const result of [ordersRes, labsRes, vitalsRes, imagingRes]) if (result.error) throw result.error;
      const entries = buildAssignmentTimelineEntries({ assignment: { id: assignment.id, completed_at: assignment.completed_at, student_progress_note: assignment.student_progress_note }, assignmentId, targetRoomIds: await lineage(client, roomId), messages: messages ?? [], orders: (ordersRes.data ?? []) as TimelineOrderRow[], labs: (labsRes.data ?? []) as TimelineLabRow[], vitals: (vitalsRes.data ?? []) as TimelineVitalRow[], imaging: (imagingRes.data ?? []) as TimelineImagingRow[] });
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
      const prompt = `${CANONICAL_RUBRIC}\n\nFORMATIVE NOTICE: ${formativeNotice}\n\nCASE-SPECIFIC EVALUATION KEY (${key.version}):\n${JSON.stringify(key, null, 2)}\n\nSCORING BOUNDARY: score only events at or after ${start.scoring_start_at}. Baseline chart context and prior/setup events are excluded from scores.\n\nCURRENT ATTEMPT EVIDENCE (${sourceEventIds.length} events):\n${renderTimelineEntriesForEvaluation(scoredEntries)}\n\nProgress note: ${assignment.student_progress_note || 'Not observed'}\n\nReturn JSON with communication_score, mdm_score, communication_breakdown.focused_information_gathering (0-2), communication_breakdown.closed_loop_team_communication (0-3), mdm_breakdown.orders_monitoring_quality (0-3), mdm_breakdown.clinical_reasoning_documentation (0-2), safety_result {level, action, rationale, evidence_event_ids}, learning_objectives, strengths, improvements, recommendations, and an action_review array. Use not observed/insufficient evidence where appropriate. Do not return an overall score or deductions.`;
      const completion = await new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') }).chat.completions.create({ model: getOpenAIModel('generate_feedback'), messages: [{ role: 'system', content: EVALUATION_SYSTEM_PROMPT }, { role: 'user', content: prompt }], response_format: { type: 'json_object' }, max_completion_tokens: 3000 });
      const evaluation = canonicalizeEvaluation(JSON.parse(completion.choices[0].message.content ?? '{}') as Partial<EvaluationScoringResponse>);
      const debrief = { formative_notice: formativeNotice, case_goals: key.goals, approach_summary: evaluation.learning_objectives, strengths: evaluation.strengths, improvements: evaluation.improvements, recommendations: evaluation.recommendations, action_review: (JSON.parse(completion.choices[0].message.content ?? '{}') as Record<string, unknown>).action_review ?? [], safety_result: evaluation.safety_result, scoring_start_at: start.scoring_start_at };
      const legacy = { summary: evaluation.learning_objectives, clinical_reasoning: { score: evaluation.mdm_score, comments: evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback, strengths: [evaluation.mdm_breakdown.clinical_reasoning_documentation.feedback], areas_for_improvement: evaluation.improvements }, communication_skills: { score: evaluation.communication_score, comments: evaluation.communication_breakdown.closed_loop_team_communication.feedback, strengths: [evaluation.communication_breakdown.focused_information_gathering.feedback], areas_for_improvement: evaluation.improvements }, recommendations: evaluation.recommendations };
      const run = await client.from('feedback_assessment_runs').insert({ ...provenance, technical_incomplete: false, result: { evaluation, debrief } }).select('id').single();
      if (run.error) throw run.error;
      const { error: updateError } = await client.from('student_room_assignments').update({ feedback_status: 'completed', feedback_error: null, communication_score: evaluation.communication_score, mdm_score: evaluation.mdm_score, communication_breakdown: evaluation.communication_breakdown, mdm_breakdown: evaluation.mdm_breakdown, learning_objectives: evaluation.learning_objectives, grade: null, nurse_feedback: legacy, feedback_generated_at: new Date().toISOString(), scoring_start_at: start.scoring_start_at, rubric_version: FEEDBACK_RUBRIC_VERSION, case_key_version: key.version || CASE_KEY_VERSION, assessment_version: ASSESSMENT_VERSION, source_event_ids: sourceEventIds, technical_incomplete: false, safety_result: evaluation.safety_result, feedback_debrief: debrief }).eq('id', assignmentId);
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
