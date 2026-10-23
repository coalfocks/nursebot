import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { canonicalizeEvaluation, hasValidSixComponentEvaluation } from '../_shared/evaluation-scoring.ts';
import { csvEscape, deidentifyStudyResult, FACULTY_STUDY_PROTOCOL_VERSION, snapshotAssignmentProtection, STUDY_SHEET_COLUMNS, studySheetRow, validateStudyManifest, type FacultyStudyManifest } from '../_shared/faculty-study-contract.ts';
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
  const roomProbe = await client.from('feedback_evaluator_configs').select('id, version, evaluator_prompt, scope, room_id').eq('scope', 'room').eq('room_id', roomId).eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle();
  if (roomProbe.error) throw new Error(`FEEDBACK_CONFIG_UNAVAILABLE:${roomProbe.error.message}`);
  if (roomProbe.data) return roomProbe.data as { id: string; version: number; evaluator_prompt: string; scope: string; room_id: number };
  const probe = await client.from('feedback_evaluator_configs').select('id, version, evaluator_prompt, scope, room_id').eq('scope', 'global').eq('status', 'active').order('version', { ascending: false }).limit(1).maybeSingle();
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
    if (!assignmentResult.data) throw new Error(`CONTEXT_UNRECOVERABLE:Case ${item.case_number} assignment not found`);
    if (assignmentResult.data.status !== 'completed') throw new Error(`CONTEXT_UNRECOVERABLE:Case ${item.case_number} assignment is not completed`);
    const roomId = Number(assignmentResult.data.room_id);
    const config = await activeConfig(client, roomId);
    if (config.evaluator_prompt.trim() !== manifest.prompt_text.trim()) throw new Error(`PROMPT_CONFIG_MISMATCH:Case ${item.case_number} active ${config.scope} evaluator v${config.version} does not match the supplied frozen prompt`);
    attestations.push({ case_number: item.case_number, assignment_id: item.assignment_id, room_id: roomId, config_id: config.id, config_version: config.version, config_scope: config.scope });
  }
  const model = getOpenAIModel('generate_feedback');
  if (model !== manifest.expected_model) throw new Error(`MODEL_MISMATCH:deployed generator resolves ${model}, manifest requires ${manifest.expected_model}`);
  return { attestations, model, generator_revision: generatorRevision() };
};

const exactContext = async (client: ReturnType<typeof serviceClient>, assignmentId: string) => {
  const tables = ['chat_messages', 'medical_orders', 'lab_results', 'vital_signs', 'imaging_studies', 'learner_action_events', 'patient_chat_messages', 'consultant_chat_messages'];
  const rows: Record<string, unknown[]> = {};
  for (const table of tables) {
    let query = client.from(table).select('*').eq('assignment_id', assignmentId);
    if (['medical_orders', 'lab_results', 'vital_signs', 'imaging_studies'].includes(table)) query = query.is('deleted_at', null);
    const result = await query;
    if (result.error) throw new Error(`CONTEXT_UNRECOVERABLE:${table}:${result.error.message}`);
    rows[table] = result.data ?? [];
  }
  return rows;
};

const evaluate = async (manifest: FacultyStudyManifest, item: FacultyStudyManifest['attempts'][number], assignment: Record<string, unknown>, context: Record<string, unknown[]>, model: string) => {
  const prompt = `${manifest.prompt_text}\n\nThis is a deidentified faculty study. Evaluate only this immutable historical assignment context. Do not infer missing events. Return JSON with six scored components, communication_score, clinical_reasoning_score, strengths, improvements, recommendations, and evidence_event_ids.\n\nASSIGNMENT SNAPSHOT (Case ${item.case_number}; private assignment identity omitted):\n${JSON.stringify({ status: assignment.status, completed_at: assignment.completed_at, student_progress_note: assignment.student_progress_note, room_id: assignment.room_id })}\n\nHISTORICAL CONTEXT (assignment_id exact; no room fallback; shared-room and other-student rows excluded):\n${JSON.stringify(context)}`;
  const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
  const completion = await openai.chat.completions.create({ model, messages: [{ role: 'system', content: 'You are a clinical education feedback evaluator. Treat the supplied historical context as the complete evidence boundary.' }, { role: 'user', content: prompt }], response_format: { type: 'json_object' }, max_completion_tokens: 3000 });
  const raw = JSON.parse(completion.choices[0].message.content ?? '{}') as Record<string, unknown>;
  if (!hasValidSixComponentEvaluation(raw)) throw new Error('MODEL_OUTPUT_INVALID:six-component contract failed');
  return canonicalizeEvaluation(raw);
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

const run = async (client: ReturnType<typeof serviceClient>, batchId: string) => {
  const batchResult = await client.from('faculty_study_batches').select('*').eq('id', batchId).single();
  if (batchResult.error) throw batchResult.error;
  const batch = batchResult.data as Record<string, unknown>;
  const manifest = validateStudyManifest(batch.manifest);
  const model = String(batch.model);
  const claim = await client.from('faculty_study_batches').update({ status: 'running', started_at: new Date().toISOString(), error: null }).eq('id', batchId).eq('status', 'prepared').select('id').maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) throw new Error('STUDY_BATCH_NOT_PREPARED_OR_ALREADY_RUNNING');
  try { for (const item of manifest.attempts) {
    let snapshot: Record<string, unknown> = { assignment_id: item.assignment_id, case_number: item.case_number };
    let result: Record<string, unknown> = { case_number: item.case_number, status: 'error', prompt_version: batch.prompt_version, model };
    try {
      const assignmentResult = await client.from('student_room_assignments').select('*').eq('id', item.assignment_id).maybeSingle();
      if (assignmentResult.error) throw assignmentResult.error;
      if (!assignmentResult.data) throw new Error('ASSIGNMENT_NOT_FOUND');
      const assignment = assignmentResult.data as Record<string, unknown>;
      snapshot = { assignment_id: item.assignment_id, case_number: item.case_number, status: assignment.status, completed_at: assignment.completed_at, room_id: assignment.room_id, student_progress_note: assignment.student_progress_note, existing_feedback: snapshotAssignmentProtection(assignment) };
      if (assignment.status !== 'completed') throw new Error('CONTEXT_UNRECOVERABLE:assignment is not completed');
      const context = await exactContext(client, item.assignment_id);
      const evaluation = await evaluate(manifest, item, assignment, context, model);
      const evidenceEventIds = [...new Set([
        ...Object.values(evaluation.communication_breakdown).flatMap((value) => (value as { evidence_event_ids?: unknown })?.evidence_event_ids ?? []),
        ...Object.values(evaluation.clinical_reasoning_breakdown).flatMap((value) => (value as { evidence_event_ids?: unknown })?.evidence_event_ids ?? []),
        ...evaluation.safety_result.evidence_event_ids,
      ].filter((value): value is string => typeof value === 'string'))];
      result = { case_number: item.case_number, status: 'completed', evaluation, evidence_event_ids: evidenceEventIds, generated_at: new Date().toISOString(), prompt_version: batch.prompt_version, model };
    } catch (error) {
      result.error = { code: errorCode(error) || message(error).split(':')[0], message: message(error), phase: 'attempt', retryable: false };
    }
    const insert = await client.from('faculty_study_results').upsert({ batch_id: batchId, case_number: item.case_number, assignment_id: item.assignment_id, historical_snapshot: snapshot, result: result.status === 'completed' ? result : null, error: result.error ?? null, generated_at: result.generated_at ?? null, prompt_version: batch.prompt_version, model }, { onConflict: 'batch_id,case_number' });
    if (insert.error) throw insert.error;
  }
    const done = await client.from('faculty_study_batches').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', batchId).eq('status', 'running');
    if (done.error) throw done.error;
    return { batch_id: batchId, learner_writes: 0, result_writes: manifest.attempts.length };
  } catch (error) {
    await client.from('faculty_study_batches').update({ status: 'failed', completed_at: new Date().toISOString(), error: { code: errorCode(error), message: message(error) } }).eq('id', batchId).eq('status', 'running');
    throw error;
  }
};

const exportBatch = async (client: ReturnType<typeof serviceClient>, batchId: string) => {
  const [batchResult, resultsResult] = await Promise.all([client.from('faculty_study_batches').select('id, batch_key, manifest, prompt_version, model, generator_revision, evaluator_config_revision, created_at').eq('id', batchId).single(), client.from('faculty_study_results').select('case_number, result, error, generated_at, prompt_version, model').eq('batch_id', batchId).order('case_number')]);
  if (batchResult.error) throw batchResult.error;
  if (resultsResult.error) throw resultsResult.error;
  const resultByCase = new Map((resultsResult.data ?? []).map((row) => [row.case_number, row]));
  const manifest = validateStudyManifest((batchResult.data as Record<string, unknown>).manifest);
  const results = manifest.attempts.map((item) => {
    const row = resultByCase.get(item.case_number);
    return row ? ({ case_number: row.case_number, status: row.error ? 'error' : 'completed', ...(row.result ?? {}), error: row.error, generated_at: row.generated_at, prompt_version: row.prompt_version, model: row.model } as Record<string, unknown>) : ({ case_number: item.case_number, status: 'error', error: { code: 'STUDY_RESULT_MISSING', message: 'No isolated result was recorded for this case.', phase: 'export', retryable: false }, generated_at: null, prompt_version: batchResult.data.prompt_version, model: batchResult.data.model } as Record<string, unknown>);
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
      case_numbers: manifest.attempts.map((item) => item.case_number),
    },
    results,
  };
  const sheet = [STUDY_SHEET_COLUMNS.join(','), ...results.map((row) => studySheetRow(row).map(csvEscape).join(','))].join('\n');
  const documents = results.map((row) => ({ filename: `case-${String(row.case_number).padStart(2, '0')}-feedback.json`, content: JSON.stringify(deidentifyStudyResult(row), null, 2) }));
  return { raw, sheet, documents, learner_writes: 0 };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const client = serviceClient();
    const userId = await requireAdmin(req, client);
    const body = await req.json() as Record<string, unknown>;
    const action = body.action;
    if (action === 'prepare') return json(await prepare(client, userId, validateStudyManifest(body.manifest)));
    if (action === 'run') return json(await run(client, String(body.batch_id)));
    if (action === 'export') return json(await exportBatch(client, String(body.batch_id)));
    throw new Error('STUDY_ACTION_INVALID');
  } catch (error) {
    const status = /AUTH|REQUIRED|INVALID|UNAVAILABLE|MISMATCH|UNVERIFIED/.test(message(error)) ? 400 : 500;
    return json({ error: { code: errorCode(error) || message(error).split(':')[0], message: message(error) } }, status);
  }
});
