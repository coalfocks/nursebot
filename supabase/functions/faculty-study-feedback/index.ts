import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { EVALUATION_SYSTEM_PROMPT, CANONICAL_RUBRIC } from '../_shared/evaluation-prompts.ts';
import { buildAssignmentTimelineEntries, renderTimelineEntriesForEvaluation, type TimelineChatMessageRow, type TimelineConsultantMessageRow, type TimelineImagingRow, type TimelineLabRow, type TimelineLearnerActionRow, type TimelineOrderRow, type TimelinePatientMessageRow, type TimelineVitalRow } from '../_shared/assignment-timeline.ts';
import { canonicalizeEvaluation, hasValidSixComponentEvaluation, type EvaluationScoringResponse } from '../_shared/evaluation-scoring.ts';
import { FEEDBACK_RUBRIC_VERSION, ASSESSMENT_VERSION, CASE_KEY_VERSION, resolveCaseEvaluationKey } from '../_shared/feedback-contract.ts';
import { csvEscape, deidentifyStudyResult, FACULTY_STUDY_PROTOCOL_VERSION, protectedAssignmentUnchanged, redactStudyValue, snapshotAssignmentProtection, STUDY_SHEET_COLUMNS, studySheetRow, validateStudyManifest, type FacultyStudyManifest } from '../_shared/faculty-study-contract.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
const errorCode = (error: unknown) => typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : 'UNKNOWN';
const message = (error: unknown) => error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message?: unknown }).message) : String(error);

const serviceClient = () => createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

const requireAdmin = async (req: Request, client: ReturnType<typeof serviceClient>) => {
  const authorization = req.headers.get('authorization');
  if (!authorization) throw new Error('STUDY_AUTH_REQUIRED');
  const tokenClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: userError } = await tokenClient.auth.getUser();
  if (userError || !userData.user) throw new Error('STUDY_AUTH_INVALID');
  const { data: profile, error: profileError } = await client.from('profiles').select('id, role').eq('id', userData.user.id).maybeSingle();
  if (profileError) throw profileError;
  if (profile?.role !== 'super_admin') throw new Error('STUDY_SUPERADMIN_REQUIRED');
  return userData.user.id;
};

const activeConfig = async (client: ReturnType<typeof serviceClient>, roomId: number) => {
  const roomProbe = await client.from('feedback_evaluator_configs').select('id, version, evaluator_prompt, scoring_anchors, scope, room_id').eq('scope', 'room').eq('room_id', roomId).eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle();
  if (roomProbe.error) throw new Error(`FEEDBACK_CONFIG_UNAVAILABLE:${roomProbe.error.message}`);
  if (roomProbe.data) return roomProbe.data as { id: string; version: number; evaluator_prompt: string; scope: string; room_id: number };
  const probe = await client.from('feedback_evaluator_configs').select('id, version, evaluator_prompt, scoring_anchors, scope, room_id').eq('scope', 'global').eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle();
  if (probe.error) throw new Error(`FEEDBACK_CONFIG_UNAVAILABLE:${probe.error.message}`);
  if (!probe.data) throw new Error('FEEDBACK_CONFIG_UNAVAILABLE:no active global evaluator configuration');
  return probe.data as { id: string; version: number; evaluator_prompt: string; scope: string; room_id: number | null };
};

const generatorRevision = () => {
  const value = Deno.env.get('GENERATE_FEEDBACK_REVISION')?.trim();
  if (!value) throw new Error('GENERATOR_REVISION_UNVERIFIED');
  return value;
};

const verifyRuntime = async (client: ReturnType<typeof serviceClient>, manifest: FacultyStudyManifest) => {
  const attestations: Array<Record<string, unknown>> = [];
  for (const item of manifest.attempts) {
    const assignmentResult = await client.from('student_room_assignments').select('id, room_id, status, completed_at').eq('id', item.assignment_id).maybeSingle();
    if (assignmentResult.error) throw new Error(`CONTEXT_UNRECOVERABLE:assignment:${assignmentResult.error.message}`);
    if (!assignmentResult.data) throw new Error(`CONTEXT_UNRECOVERABLE:batch ordinal ${item.batch_ordinal} assignment not found`);
    if (assignmentResult.data.status !== 'completed') throw new Error(`CONTEXT_UNRECOVERABLE:batch ordinal ${item.batch_ordinal} assignment is not completed`);
    const roomId = Number(assignmentResult.data.room_id);
    const config = await activeConfig(client, roomId);
    if (config.evaluator_prompt.trim() !== manifest.prompt_text.trim()) throw new Error(`PROMPT_CONFIG_MISMATCH:batch ordinal ${item.batch_ordinal} active ${config.scope} evaluator v${config.version} does not match the supplied frozen prompt`);
    attestations.push({ batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, assignment_id: item.assignment_id, room_id: roomId, config_id: config.id, config_version: config.version, config_scope: config.scope, evaluator_prompt: config.evaluator_prompt, scoring_anchors: (config as { scoring_anchors?: unknown }).scoring_anchors ?? {} });
  }
  const model = getOpenAIModel('generate_feedback');
  if (model !== manifest.expected_model) throw new Error(`MODEL_MISMATCH:deployed generator resolves ${model}, manifest requires ${manifest.expected_model}`);
  return { attestations, model, generator_revision: generatorRevision() };
};

const rowTimestamp = (table: string, row: Record<string, unknown>) => {
  const keys: Record<string, string[]> = {
    chat_messages: ['created_at'], medical_orders: ['order_time', 'created_at'], lab_results: ['result_time', 'collection_time', 'created_at'],
    vital_signs: ['timestamp', 'created_at'], imaging_studies: ['report_generated_at', 'order_time', 'created_at'], learner_action_events: ['occurred_at', 'created_at'],
    patient_chat_messages: ['created_at'], consultant_chat_messages: ['request_receipt_at', 'created_at'],
  };
  return (keys[table] ?? []).map((key) => row[key]).find((value) => typeof value === 'string' && !Number.isNaN(new Date(value).getTime())) as string | undefined;
};

const exactContext = async (client: ReturnType<typeof serviceClient>, assignmentId: string, completedAt: string) => {
  const tables = ['chat_messages', 'medical_orders', 'lab_results', 'vital_signs', 'imaging_studies', 'learner_action_events', 'patient_chat_messages', 'consultant_chat_messages'];
  const rows: Record<string, unknown[]> = {};
  const availability: Record<string, unknown> = { cutoff: completedAt, excluded_after_cutoff: {}, missing_timestamp: [] };
  for (const table of tables) {
    let query = client.from(table).select('*').eq('assignment_id', assignmentId);
    if (['medical_orders', 'lab_results', 'vital_signs', 'imaging_studies'].includes(table)) query = query.is('deleted_at', null);
    const result = await query;
    if (result.error) throw new Error(`CONTEXT_UNRECOVERABLE:${table}:${result.error.message}`);
    const sourceRows = (result.data ?? []) as Record<string, unknown>[];
    const kept = sourceRows.filter((row) => {
      const timestamp = rowTimestamp(table, row);
      if (!timestamp) { (availability.missing_timestamp as string[]).push(`${table}:${String(row.id ?? 'unknown')}`); return false; }
      if (new Date(timestamp).getTime() > new Date(completedAt).getTime()) {
        const excluded = availability.excluded_after_cutoff as Record<string, number>;
        excluded[table] = (excluded[table] ?? 0) + 1;
        return false;
      }
      return true;
    });
    rows[table] = kept;
  }
  if (!rows.chat_messages?.length) throw new Error('CONTEXT_UNRECOVERABLE:chat_messages has no available historical rows at the completion cutoff');
  return { rows, availability };
};

const allowedEvidence = (evaluation: EvaluationScoringResponse, sourceIds: Set<string>) => {
  const filter = (ids: unknown) => Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && sourceIds.has(id)) : [];
  for (const component of Object.values(evaluation.communication_breakdown)) component.evidence_event_ids = filter(component.evidence_event_ids);
  for (const component of Object.values(evaluation.clinical_reasoning_breakdown)) component.evidence_event_ids = filter(component.evidence_event_ids);
  evaluation.safety_result.evidence_event_ids = filter(evaluation.safety_result.evidence_event_ids);
  return [...new Set([...Object.values(evaluation.communication_breakdown), ...Object.values(evaluation.clinical_reasoning_breakdown)].flatMap((component) => component.evidence_event_ids ?? []).concat(evaluation.safety_result.evidence_event_ids))];
};

const evaluate = async (manifest: FacultyStudyManifest, item: FacultyStudyManifest['attempts'][number], assignment: Record<string, unknown>, context: { rows: Record<string, unknown[]>; availability: Record<string, unknown> }, model: string, evaluator: Record<string, unknown>) => {
  const rows = context.rows;
  const entries = buildAssignmentTimelineEntries({ assignment: { id: String(assignment.id), completed_at: String(assignment.completed_at), student_progress_note: typeof assignment.student_progress_note === 'string' ? assignment.student_progress_note : null }, assignmentId: item.assignment_id, targetRoomIds: null, messages: (rows.chat_messages ?? []) as TimelineChatMessageRow[], orders: (rows.medical_orders ?? []) as TimelineOrderRow[], labs: (rows.lab_results ?? []) as TimelineLabRow[], vitals: (rows.vital_signs ?? []) as TimelineVitalRow[], imaging: (rows.imaging_studies ?? []) as TimelineImagingRow[], learnerActions: (rows.learner_action_events ?? []) as TimelineLearnerActionRow[], patientMessages: (rows.patient_chat_messages ?? []) as TimelinePatientMessageRow[], consultantMessages: (rows.consultant_chat_messages ?? []) as TimelineConsultantMessageRow[] });
  const sourceIds = new Set(entries.map((entry) => entry.id));
  const room = (assignment.scenario_baseline && typeof assignment.scenario_baseline === 'object' ? assignment.scenario_baseline : assignment.room ?? {}) as Record<string, unknown>;
  const caseKey = resolveCaseEvaluationKey(room);
  const prompt = `${EVALUATION_SYSTEM_PROMPT}\n\n${CANONICAL_RUBRIC}\n\nACTIVE EVALUATOR PROMPT (frozen at preparation):\n${String(evaluator.evaluator_prompt ?? '')}\n\nSCORING ANCHORS (frozen at preparation):\n${JSON.stringify(evaluator.scoring_anchors ?? {}, null, 2)}\n\nThis is a deidentified faculty study. Evaluate only this immutable historical assignment context. Do not infer missing events. The evidence boundary is exactly the following assignment-scoped timeline, reconstructed with the deployed case key version ${caseKey.version || CASE_KEY_VERSION}, rubric ${FEEDBACK_RUBRIC_VERSION}, and assessment ${ASSESSMENT_VERSION}.\n\nCASE LABELS (preserve in output): specialty=${item.specialty}; case=${item.case_label}; packet=${item.packet_label}\n\nASSIGNMENT SNAPSHOT:\n${JSON.stringify({ status: assignment.status, completed_at: assignment.completed_at, student_progress_note: assignment.student_progress_note, room_id: assignment.room_id, scenario_baseline_version: assignment.scenario_baseline_version })}\n\nHISTORICAL CHART RECONSTRUCTION:\n${JSON.stringify(room)}\n\nAVAILABILITY:\n${JSON.stringify(context.availability)}\n\nHISTORICAL EVIDENCE:\n${renderTimelineEntriesForEvaluation(entries)}\n\nReturn JSON with the six scored components, domain scores, strengths, improvements, recommendations, safety_result, and evidence_event_ids copied only from this evidence boundary.`;
  const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
  const completion = await openai.chat.completions.create({ model, messages: [{ role: 'system', content: 'You are a clinical education feedback evaluator. Treat the supplied historical context as the complete evidence boundary.' }, { role: 'user', content: prompt }], response_format: { type: 'json_object' }, max_completion_tokens: 3000 });
  const raw = JSON.parse(completion.choices[0].message.content ?? '{}') as Record<string, unknown>;
  if (!hasValidSixComponentEvaluation(raw)) throw new Error('MODEL_OUTPUT_INVALID:six-component contract failed');
  const canonical = canonicalizeEvaluation(raw);
  return { raw, canonical, evidenceEventIds: allowedEvidence(canonical, sourceIds), entries, caseKey };
};

const prepare = async (client: ReturnType<typeof serviceClient>, userId: string, manifest: FacultyStudyManifest) => {
  const runtime = await verifyRuntime(client, manifest);
  const manifestText = JSON.stringify(manifest);
  const promptHash = await sha256(manifest.prompt_text);
  const manifestHash = await sha256(manifestText);
  const configRevisions = [...new Set(runtime.attestations.map((item) => `${item.config_id}:v${item.config_version}`))];
  const insert = await client.from('faculty_study_batches').insert({ batch_key: manifest.batch_key, manifest, manifest_sha256: manifestHash, prompt_version: manifest.prompt_version, prompt_sha256: promptHash, model: runtime.model, protocol_version: FACULTY_STUDY_PROTOCOL_VERSION, generator_revision: runtime.generator_revision, evaluator_config_revision: configRevisions.length === 1 ? configRevisions[0] : `mixed:${configRevisions.join(',')}`, attempt_attestations: runtime.attestations, created_by: userId }).select('id, batch_key, status, prompt_version, model, generator_revision, evaluator_config_revision, attempt_attestations').single();
  if (insert.error) throw insert.error;
  return { batch: insert.data, writes: ['faculty_study_batches'], learner_writes: 0 };
};

const privateTermsForAssignment = async (client: ReturnType<typeof serviceClient>, assignment: Record<string, unknown>) => {
  const terms: string[] = [];
  const roomId = Number(assignment.room_id);
  const patient = await client.from('patients').select('first_name, last_name, mrn').eq('room_id', roomId).limit(1).maybeSingle();
  if (!patient.error && patient.data) terms.push(patient.data.first_name, patient.data.last_name, patient.data.mrn);
  const student = typeof assignment.student_id === 'string' ? await client.from('profiles').select('full_name, email').eq('id', assignment.student_id).maybeSingle() : { data: null, error: null };
  if (!student.error && student.data) terms.push(student.data.full_name, student.data.email);
  return terms.filter((term): term is string => typeof term === 'string' && term.trim().length > 1);
};

const assertProtectedAssignmentReadback = async (client: ReturnType<typeof serviceClient>, assignmentId: string, before: Record<string, unknown>) => {
  const readback = await client.from('student_room_assignments').select('*').eq('id', assignmentId).maybeSingle();
  if (readback.error) throw readback.error;
  if (!readback.data || !protectedAssignmentUnchanged(before, readback.data as Record<string, unknown>)) throw new Error('STUDY_PROTECTED_ASSIGNMENT_CHANGED: feedback/status/grade readback differs from the frozen pre-model snapshot');
};

const run = async (client: ReturnType<typeof serviceClient>, batchId: string, requestedLimit: unknown) => {
  const batchResult = await client.from('faculty_study_batches').select('*').eq('id', batchId).single();
  if (batchResult.error) throw batchResult.error;
  const batch = batchResult.data as Record<string, unknown>;
  const manifest = validateStudyManifest(batch.manifest);
  const model = String(batch.model);
  const limit = Math.max(1, Math.min(30, Number.isInteger(Number(requestedLimit)) ? Number(requestedLimit) : 5));
  const existingResult = await client.from('faculty_study_results').select('batch_ordinal, result, error').eq('batch_id', batchId);
  if (existingResult.error) throw existingResult.error;
  const doneOrdinals = new Set((existingResult.data ?? []).map((row) => row.batch_ordinal));
  const pending = manifest.attempts.filter((item) => !doneOrdinals.has(item.batch_ordinal)).slice(0, limit);
  if (pending.length === 0) return { batch_id: batchId, learner_writes: 0, result_writes: doneOrdinals.size, status: 'completed' };
  const claim = await client.from('faculty_study_batches').update({ status: 'running', started_at: new Date().toISOString(), error: null }).eq('id', batchId).in('status', ['prepared', 'failed']).select('id').maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) throw new Error('STUDY_BATCH_NOT_PREPARED_OR_ALREADY_RUNNING');
  try { for (const item of pending) {
    let snapshot: Record<string, unknown> = { assignment_id: item.assignment_id, batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label };
    let result: Record<string, unknown> = { batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, status: 'error', prompt_version: batch.prompt_version, model };
    let rawModelResponse: unknown = null;
    let frozenInput: Record<string, unknown> | null = null;
    try {
      const assignmentResult = await client.from('student_room_assignments').select('*, room:room_id (*)').eq('id', item.assignment_id).maybeSingle();
      if (assignmentResult.error) throw assignmentResult.error;
      if (!assignmentResult.data) throw new Error('ASSIGNMENT_NOT_FOUND');
      const assignment = assignmentResult.data as Record<string, unknown>;
      const privateTerms = await privateTermsForAssignment(client, assignment);
      snapshot = { assignment_id: item.assignment_id, batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, status: assignment.status, completed_at: assignment.completed_at, room_id: assignment.room_id, existing_feedback: snapshotAssignmentProtection(assignment) };
      if (assignment.status !== 'completed') throw new Error('CONTEXT_UNRECOVERABLE:assignment is not completed');
      const completedAt = typeof assignment.completed_at === 'string' ? assignment.completed_at : '';
      if (!completedAt) throw new Error('CONTEXT_UNRECOVERABLE:assignment has no completed_at cutoff');
      const context = await exactContext(client, item.assignment_id, completedAt);
      const attestation = (batch.attempt_attestations as Array<Record<string, unknown>>).find((candidate) => candidate.batch_ordinal === item.batch_ordinal) ?? {};
      const sourceHashes = { context_sha256: await sha256(JSON.stringify(context)), assignment_snapshot_sha256: await sha256(JSON.stringify(snapshot)) };
      const historicalChart = (assignment.scenario_baseline && typeof assignment.scenario_baseline === 'object' ? assignment.scenario_baseline : assignment.room ?? {}) as Record<string, unknown>;
      frozenInput = { assignment_snapshot: snapshot, context, chart_reconstruction: historicalChart, source_hashes: sourceHashes, redaction_terms: privateTerms, case_key: resolveCaseEvaluationKey(historicalChart), evaluator: { prompt: attestation.evaluator_prompt, scoring_anchors: attestation.scoring_anchors }, rubric_version: FEEDBACK_RUBRIC_VERSION, assessment_version: ASSESSMENT_VERSION };
      const frozen = await client.from('faculty_study_results').upsert({ batch_id: batchId, batch_ordinal: item.batch_ordinal, assignment_id: item.assignment_id, historical_snapshot: snapshot, frozen_input: frozenInput, result: null, canonical_result: null, raw_model_response: null, error: null, prompt_version: batch.prompt_version, model }, { onConflict: 'batch_id,batch_ordinal' });
      if (frozen.error) throw frozen.error;
      const evaluation = await evaluate(manifest, item, assignment, context, model, { evaluator_prompt: attestation.evaluator_prompt, scoring_anchors: attestation.scoring_anchors });
      rawModelResponse = evaluation.raw;
      await assertProtectedAssignmentReadback(client, item.assignment_id, { ...assignment, status: snapshot.status });
      result = { batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, status: 'completed', evaluation: evaluation.canonical, evidence_event_ids: evaluation.evidenceEventIds, generated_at: new Date().toISOString(), prompt_version: batch.prompt_version, model, redaction_terms: privateTerms };
      const completed = await client.from('faculty_study_results').update({ result, canonical_result: evaluation.canonical, raw_model_response: evaluation.raw, generated_at: result.generated_at }).eq('batch_id', batchId).eq('batch_ordinal', item.batch_ordinal);
      if (completed.error) throw completed.error;
    } catch (error) {
      result.error = { code: errorCode(error) || message(error).split(':')[0], message: message(error), phase: 'attempt', retryable: false };
      if (snapshot.assignment_id) {
        try { await assertProtectedAssignmentReadback(client, item.assignment_id, { ...snapshot, ...snapshot.existing_feedback as Record<string, unknown> }); }
        catch (readbackError) { result.error = { code: errorCode(readbackError) || message(readbackError).split(':')[0], message: message(readbackError), phase: 'protection-readback', retryable: false }; }
      }
      const failed = await client.from('faculty_study_results').upsert({ batch_id: batchId, batch_ordinal: item.batch_ordinal, assignment_id: item.assignment_id, historical_snapshot: snapshot, frozen_input: frozenInput, result: null, canonical_result: null, raw_model_response: rawModelResponse, error: result.error, prompt_version: batch.prompt_version, model }, { onConflict: 'batch_id,batch_ordinal' });
      if (failed.error) throw failed.error;
    }
  }
    const completedCount = doneOrdinals.size + pending.length;
    const finished = completedCount >= manifest.attempts.length;
    const done = await client.from('faculty_study_batches').update({ status: finished ? 'completed' : 'prepared', completed_at: finished ? new Date().toISOString() : null, next_batch_ordinal: finished ? null : manifest.attempts.find((item) => !doneOrdinals.has(item.batch_ordinal) && !pending.some((processed) => processed.batch_ordinal === item.batch_ordinal))?.batch_ordinal ?? null }).eq('id', batchId).eq('status', 'running');
    if (done.error) throw done.error;
    return { batch_id: batchId, learner_writes: 0, result_writes: completedCount, status: finished ? 'completed' : 'prepared', remaining: manifest.attempts.length - completedCount };
  } catch (error) {
    await client.from('faculty_study_batches').update({ status: 'failed', completed_at: new Date().toISOString(), error: { code: errorCode(error), message: message(error) } }).eq('id', batchId).eq('status', 'running');
    throw error;
  }
};

const exportBatch = async (client: ReturnType<typeof serviceClient>, batchId: string) => {
  const [batchResult, resultsResult] = await Promise.all([client.from('faculty_study_batches').select('id, batch_key, manifest, prompt_version, model, generator_revision, evaluator_config_revision, protocol_version, created_at, attempt_attestations').eq('id', batchId).single(), client.from('faculty_study_results').select('batch_ordinal, assignment_id, historical_snapshot, frozen_input, canonical_result, raw_model_response, result, error, generated_at, prompt_version, model').eq('batch_id', batchId).order('batch_ordinal')]);
  if (batchResult.error) throw batchResult.error;
  if (resultsResult.error) throw resultsResult.error;
  const resultByCase = new Map((resultsResult.data ?? []).map((row) => [row.batch_ordinal, row]));
  const manifest = validateStudyManifest((batchResult.data as Record<string, unknown>).manifest);
  const results = manifest.attempts.map((item) => {
    const row = resultByCase.get(item.batch_ordinal);
    if (!row) return { batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, status: 'error', error: { code: 'STUDY_RESULT_MISSING', message: 'No isolated result was recorded for this batch ordinal.', phase: 'export', retryable: false }, generated_at: null, prompt_version: batchResult.data.prompt_version, model: batchResult.data.model } as Record<string, unknown>;
    const privateTerms = ((row.frozen_input as Record<string, unknown> | null)?.redaction_terms as string[] | undefined) ?? [];
    const canonical = row.result && typeof row.result === 'object' ? row.result as Record<string, unknown> : { batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, status: row.error ? 'error' : 'completed' };
    const reviewerCanonical = deidentifyStudyResult({ ...canonical, batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, error: row.error, redaction_terms: privateTerms });
    return { ...reviewerCanonical, raw_model_response: redactStudyValue(row.raw_model_response, privateTerms), generated_at: row.generated_at, prompt_version: row.prompt_version, model: row.model } as Record<string, unknown>;
  });
  // Never put the private manifest, assignment IDs, or creator ID in a
  // downloadable artifact. The owner retains the manifest separately as the
  // Case 1–30 mapping; this export is safe to share with the study reviewers.
  const batch = batchResult.data as Record<string, unknown>;
  const raw = {
    batch: {
      id: batch.id,
      batch_key: batch.batch_key,
      prompt_version: batch.prompt_version,
      model: batch.model,
      generator_revision: batch.generator_revision,
      evaluator_config_revision: batch.evaluator_config_revision,
      created_at: batch.created_at,
      protocol_version: FACULTY_STUDY_PROTOCOL_VERSION,
      case_count: manifest.attempts.length,
      batch_ordinals: manifest.attempts.map((item) => item.batch_ordinal),
    },
    results,
  };
  const sheet = [STUDY_SHEET_COLUMNS.join(','), ...results.map((row) => studySheetRow(row).map(csvEscape).join(','))].join('\n');
  const documents = results.map((row) => ({ filename: `batch-${String(row.batch_ordinal).padStart(2, '0')}-feedback.json`, content: JSON.stringify(deidentifyStudyResult(row), null, 2) }));
  const coordinator = (resultsResult.data ?? []).map((row) => ({ batch_ordinal: row.batch_ordinal, assignment_id: row.assignment_id, historical_snapshot: row.historical_snapshot, frozen_input: row.frozen_input, canonical_result: row.canonical_result, raw_model_response: row.raw_model_response, error: row.error, generated_at: row.generated_at, prompt_version: row.prompt_version, model: row.model }));
  return { raw, sheet, documents, coordinator, learner_writes: 0 };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const client = serviceClient();
    const userId = await requireAdmin(req, client);
    const body = await req.json() as Record<string, unknown>;
    const action = body.action;
    if (action === 'prepare') return json(await prepare(client, userId, validateStudyManifest(body.manifest)));
    if (action === 'run') return json(await run(client, String(body.batch_id), body.max_cases));
    if (action === 'export') return json(await exportBatch(client, String(body.batch_id)));
    throw new Error('STUDY_ACTION_INVALID');
  } catch (error) {
    const status = /AUTH|REQUIRED|INVALID|UNAVAILABLE|MISMATCH|UNVERIFIED/.test(message(error)) ? 400 : 500;
    return json({ error: { code: errorCode(error) || message(error).split(':')[0], message: message(error) } }, status);
  }
});
