import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';
import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { EVALUATION_SYSTEM_PROMPT, CANONICAL_RUBRIC } from '../_shared/evaluation-prompts.ts';
import { buildAssignmentTimelineEntries, renderTimelineEntriesForEvaluation, type TimelineChatMessageRow, type TimelineConsultantMessageRow, type TimelineImagingRow, type TimelineLabRow, type TimelineLearnerActionRow, type TimelineOrderRow, type TimelinePatientMessageRow, type TimelineVitalRow } from '../_shared/assignment-timeline.ts';
import { canonicalizeEvaluation, hasValidSixComponentEvaluation, type EvaluationScoringResponse } from '../_shared/evaluation-scoring.ts';
import { FEEDBACK_RUBRIC_VERSION, ASSESSMENT_VERSION, CASE_KEY_VERSION, resolveCaseEvaluationKey } from '../_shared/feedback-contract.ts';
import { buildEvaluationSheetHtml, buildStudyFeedbackBackup, csvEscape, deidentifyStudyResult, FACULTY_STUDY_PROTOCOL_VERSION, isTerminalStudyResult, protectedAssignmentUnchanged, redactStudyValue, resolveStudyTargetOrdinals, snapshotAssignmentProtection, STUDY_ASSIGNMENT_PROTECTED_FIELDS, STUDY_RUN_LEASE_MS, STUDY_SHEET_COLUMNS, studyActionAllowed, studyProgress, studyResultStatus, studySheetRow, validateStudyManifest, type FacultyStudyDeploymentMode, type FacultyStudyManifest } from '../_shared/faculty-study-contract.ts';
import { writeOwnedFacultyStudyResult } from '../_shared/faculty-study-result-lease.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';
import { filterHistoricalRows, historicalEventTimestamp } from '../_shared/historical-context.ts';
import { authenticateFacultyStudyUser, isFacultyStudySuperAdmin } from '../_shared/faculty-study-auth.ts';
import { classifyHistoricalNoteCandidates, resolveLegacyCaseProvenance } from '../_shared/legacy-case-provenance.ts';
import { classifySourceReadError } from '../_shared/source-read-classification.ts';
import { optionalHistoryScope } from '../_shared/history-query-scope.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (value: unknown, status = 200, requestId?: string) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, ...(requestId ? { 'X-Study-Request-Id': requestId } : {}), 'Content-Type': 'application/json' } });
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
const errorCode = (error: unknown) => typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : 'UNKNOWN';
const message = (error: unknown) => error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message?: unknown }).message) : String(error);

const serviceClient = () => createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const deploymentMode = (): FacultyStudyDeploymentMode => {
  const configured = Deno.env.get('FACULTY_STUDY_DEPLOYMENT_MODE')?.trim().toLowerCase();
  if (configured === 'preflight-only') return 'preflight-only';
  // Fail closed: an absent or unknown mode must never expose study-enabled actions.
  return 'preflight-only';
};

const requireAdmin = async (req: Request, client: ReturnType<typeof serviceClient>, requestId: string) => {
  let userId: string;
  try {
    userId = await authenticateFacultyStudyUser(req, (options) => createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', options));
  } catch (error) {
    const authError = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: 'faculty_study_auth', request_id: requestId, stage: 'auth.getUser', code: authError === 'STUDY_AUTH_REQUIRED' ? authError : 'STUDY_AUTH_INVALID', provider_error: authError }));
    throw error instanceof Error ? error : new Error('STUDY_AUTH_INVALID');
  }
  const { data: profile, error: profileError } = await client.from('profiles').select('id, role').eq('id', userId).maybeSingle();
  if (profileError) {
    console.error(JSON.stringify({ event: 'faculty_study_auth', request_id: requestId, stage: 'profiles.lookup', user_id: userId, code: 'STUDY_PROFILE_LOOKUP_FAILED', provider_error: profileError.message }));
    throw new Error('STUDY_PROFILE_LOOKUP_FAILED');
  }
  if (!isFacultyStudySuperAdmin(profile)) {
    console.error(JSON.stringify({ event: 'faculty_study_auth', request_id: requestId, stage: 'role.check', user_id: userId, observed_role: profile?.role ?? null, code: 'STUDY_SUPERADMIN_REQUIRED' }));
    throw new Error('STUDY_SUPERADMIN_REQUIRED');
  }
  return userId;
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

const inspectRuntime = async (client: ReturnType<typeof serviceClient>, manifest: FacultyStudyManifest) => {
  const attestations: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];
  for (const item of manifest.attempts) {
    const assignmentResult = await client.from('student_room_assignments').select('id, room_id, status, completed_at').eq('id', item.assignment_id).maybeSingle();
    if (assignmentResult.error) { errors.push({ batch_ordinal: item.batch_ordinal, code: 'CONTEXT_UNRECOVERABLE', message: `assignment:${assignmentResult.error.message}` }); continue; }
    if (!assignmentResult.data) { errors.push({ batch_ordinal: item.batch_ordinal, code: 'CONTEXT_UNRECOVERABLE', message: 'assignment not found' }); continue; }
    if (assignmentResult.data.status !== 'completed') { errors.push({ batch_ordinal: item.batch_ordinal, code: 'CONTEXT_UNRECOVERABLE', message: 'assignment is not completed' }); continue; }
    const roomId = Number(assignmentResult.data.room_id);
    let config;
    try { config = await activeConfig(client, roomId); }
    catch (error) { errors.push({ batch_ordinal: item.batch_ordinal, code: errorCode(error) || message(error).split(':')[0], message: message(error) }); continue; }
    attestations.push({ batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, assignment_id: item.assignment_id, room_id: roomId, config_id: config.id, config_version: config.version, config_scope: config.scope, evaluator_prompt: config.evaluator_prompt, scoring_anchors: (config as { scoring_anchors?: unknown }).scoring_anchors ?? {} });
    if (config.evaluator_prompt.trim() !== manifest.prompt_text.trim()) errors.push({ batch_ordinal: item.batch_ordinal, code: 'PROMPT_CONFIG_MISMATCH', message: `active ${config.scope} evaluator v${config.version} does not match the supplied frozen prompt`, observed_config_id: config.id, observed_config_version: config.version, observed_config_scope: config.scope });
  }
  let model: string | null = null;
  try { model = getOpenAIModel('generate_feedback'); }
  catch (error) { errors.push({ code: errorCode(error) || message(error).split(':')[0], message: message(error) }); }
  if (model !== null && model !== manifest.expected_model) errors.push({ code: 'MODEL_MISMATCH', message: `deployed generator resolves ${model}, manifest requires ${manifest.expected_model}`, observed_model: model });
  let revision: string | null = null;
  try { revision = generatorRevision(); }
  catch (error) { errors.push({ code: errorCode(error) || message(error).split(':')[0], message: message(error) }); }
  return { ready: errors.length === 0, attestations, model, expected_model: manifest.expected_model, generator_revision: revision, errors };
};

const verifyRuntime = async (client: ReturnType<typeof serviceClient>, manifest: FacultyStudyManifest) => {
  const inspected = await inspectRuntime(client, manifest);
  if (!inspected.ready) {
    const first = inspected.errors[0] ?? { code: 'STUDY_RUNTIME_UNREADY', message: 'Runtime readiness checks failed' };
    throw new Error(`${String(first.code)}:${String(first.message)}`);
  }
  return { attestations: inspected.attestations, model: inspected.model as string, generator_revision: inspected.generator_revision as string };
};

const exactContext = async (client: ReturnType<typeof serviceClient>, assignmentId: string, completedAt: string) => {
  const tables = ['chat_messages', 'medical_orders', 'lab_results', 'vital_signs', 'imaging_studies', 'learner_action_events', 'patient_chat_messages', 'consultant_chat_messages'];
  const rows: Record<string, unknown[]> = {};
  const availability: Record<string, unknown> = { cutoff: completedAt, excluded_after_cutoff: {}, excluded_after_recorded_at: {}, excluded_after_event_time: {}, excluded_rows: [], missing_timestamp: [], missing_historical_version: [], unavailable_version_sources: [], recovered_versions: [], retained_deleted_after_cutoff: [], empty_scoped_sources: [] };
  for (const table of tables) {
    const query = client.from(table).select('*').eq('assignment_id', assignmentId);
    const result = await query;
    if (result.error) throw new Error(`CONTEXT_UNRECOVERABLE:${table}:${result.error.message}`);
    const sourceRows = (result.data ?? []) as Record<string, unknown>[];
    let versions: Record<string, unknown>[] = [];
    if (table === 'imaging_studies' && sourceRows.length) {
      const versionResult = await client.from('imaging_study_versions').select('*').in('study_id', sourceRows.map((row) => String(row.id)));
      if (versionResult.error) {
        (availability.unavailable_version_sources as string[]).push(`imaging_study_versions:${versionResult.error.message}`);
      } else {
        versions = (versionResult.data ?? []) as Record<string, unknown>[];
      }
    }
    const filtered = filterHistoricalRows(table, sourceRows, completedAt, versions);
    rows[table] = filtered.rows;
    if (!sourceRows.length) (availability.empty_scoped_sources as string[]).push(table);
    for (const key of ['excluded_after_recorded_at', 'excluded_after_event_time']) {
      Object.assign(availability[key] as Record<string, number>, filtered.availability[key as 'excluded_after_recorded_at' | 'excluded_after_event_time']);
    }
    for (const key of ['excluded_rows', 'missing_timestamp', 'missing_historical_version', 'recovered_versions', 'retained_deleted_after_cutoff']) {
      (availability[key] as unknown[]).push(...filtered.availability[key as 'excluded_rows' | 'missing_timestamp' | 'missing_historical_version' | 'recovered_versions' | 'retained_deleted_after_cutoff']);
    }
  }
  return { rows, availability };
};

const optionalHistoryRows = async (client: ReturnType<typeof serviceClient>, table: string, columns: string, assignmentId: string, roomId: number, caseVersion: string | null) => {
  let query = client.from(table).select(columns);
  const scope = optionalHistoryScope(table, assignmentId, roomId, caseVersion);
  query = scope.kind === 'room'
    ? query.eq('room_id', scope.room_id)
    : query.eq('assignment_id', scope.assignment_id);
  if (scope.kind === 'room' && scope.case_version !== null) query = query.eq('case_version', scope.case_version);
  const result = await query;
  if (result.error) {
    const failure = classifySourceReadError(result.error);
    return {
      available: false,
      rows: [],
      reason: failure.category === 'missing_table' ? 'source_table_unavailable' : failure.category === 'missing_column' ? 'source_column_unavailable' : failure.category === 'denied' ? 'source_read_denied' : 'source_read_failed',
      error_category: failure.category,
      error_code: failure.code,
      error_message: failure.message,
      scope,
    };
  }
  return { available: true, rows: (result.data ?? []) as unknown as Record<string, unknown>[], reason: null, error_category: null, error_code: null, error_message: null, scope };
};

const historicalSourceInventory = async (
  client: ReturnType<typeof serviceClient>,
  assignment: Record<string, unknown>,
  completedAt: string,
  legacyRecovery: Record<string, unknown>,
  context: { rows: Record<string, unknown[]>; availability: Record<string, unknown> },
) => {
  const assignmentId = String(assignment.id);
  const roomId = Number(assignment.room_id);
  const caseVersion = typeof assignment.case_key_version === 'string' ? assignment.case_key_version : null;
  const [assignmentMar, saveOperations, packetAudit, clinicalNotes] = await Promise.all([
    optionalHistoryRows(client, 'manual_mar_assignment_snapshots', 'id, assignment_id, source_packet_id, patient_id, room_id, case_version, packet_revision, content_hash, created_at', assignmentId, roomId, caseVersion),
    optionalHistoryRows(client, 'mar_save_operations', 'request_id, patient_id, room_id, assignment_id, case_version, content_hash, expected_revision, created_at', assignmentId, roomId, caseVersion),
    optionalHistoryRows(client, 'manual_mar_packet_audit', 'id, packet_id, request_id, patient_id, room_id, case_version, prior_revision, next_revision, payload_hash, created_at', assignmentId, roomId, caseVersion),
    // Use only the actual EMR schema. Generic *_note_versions relations are
    // not application tables and cannot establish historical recovery.
    optionalHistoryRows(client, 'clinical_notes', 'id, assignment_id, patient_id, school_id, room_id, override_scope, record_version, content, timestamp, created_at, updated_at, deleted_at', assignmentId, roomId, caseVersion),
  ]);
  const missingVersions = (context.availability.missing_historical_version ?? []) as Array<Record<string, unknown>>;
  const orderUpdates = missingVersions.filter((row) => row.table === 'medical_orders');
  const updateGroups = Object.entries(orderUpdates.reduce<Record<string, string[]>>((groups, row) => {
    const timestamp = typeof row.updated_at === 'string' ? row.updated_at : 'missing';
    (groups[timestamp] ??= []).push(String(row.id));
    return groups;
  }, {})).map(([updated_at, order_ids]) => ({ updated_at, order_ids, order_count: order_ids.length }));
  const noteMetadata = {
    assignment_value_present: typeof assignment.student_progress_note === 'string' && assignment.student_progress_note.length > 0,
    version: firstDefined(assignment, ['student_progress_note_version', 'progress_note_version', 'student_progress_note_revision']),
    recorded_at: firstDefined(assignment, ['student_progress_note_created_at', 'progress_note_created_at']),
    updated_at: firstDefined(assignment, ['student_progress_note_updated_at', 'progress_note_updated_at']),
  };
  const packetAuditScope = packetAudit.scope;
  const packetAuditInventory = {
    ...packetAudit,
    // When the assignment's legacy case version is unknown, these are room-
    // scoped version references only. They are never matched history proof.
    rows: packetAudit.rows.map((row) => ({
      ...row,
      case_version_match: packetAuditScope?.kind === 'room' && packetAuditScope.case_version !== null
        ? row.case_version === packetAuditScope.case_version
        : null,
      history_match_status: packetAuditScope?.kind === 'room' && packetAuditScope.case_version !== null
        ? row.case_version === packetAuditScope.case_version ? 'exact_version_match' : 'version_mismatch'
        : 'case_version_unknown_unmatched',
    })),
  };
  return {
    cutoff: completedAt,
    full_case_sources: {
      assignment_scenario_baseline: Boolean(assignment.scenario_baseline && typeof assignment.scenario_baseline === 'object'),
      mar_assignment_snapshot: assignmentMar,
      historical_full_case_source_proven: Boolean(assignment.scenario_baseline && typeof assignment.scenario_baseline === 'object'),
      missing_full_case_source: !assignment.scenario_baseline,
    },
    order_history: {
      scoped_current_rows: (context.rows.medical_orders ?? []).length,
      excluded_after_completion_rows: orderUpdates,
      shared_update_timestamp_groups: updateGroups,
      migration_or_audit_rows: { mar_save_operations: saveOperations, manual_mar_packet_audit: packetAuditInventory },
      content_recovery_proven: false,
      correlation_note: updateGroups.length ? 'Shared updated_at values are correlated with available audit rows only; metadata alone does not prove pre-edit content.' : null,
    },
    completed_note_history: (() => {
      const verification = classifyHistoricalNoteCandidates(clinicalNotes.rows, completedAt, {
        assignmentId,
        patientId: typeof assignment.patient_id === 'string' ? assignment.patient_id : null,
        schoolId: typeof assignment.school_id === 'string' ? assignment.school_id : null,
      });
      return {
        current_assignment_metadata: noteMetadata,
        source: clinicalNotes,
        candidates: verification.candidates,
        verified_completion_time_versions: verification.verified,
        verification_gaps: verification.verification_gaps,
        // A row, hash, or metadata timestamp is not proof of historical content.
        version_proven: clinicalNotes.available && verification.verified.length > 0,
        missing_history: !clinicalNotes.available || verification.verified.length === 0,
      };
    })(),
    archive_recovery: {
      references: legacyRecovery.references ?? [],
      identity_excluded_references: legacyRecovery.identity_excluded_references ?? [],
      missing_history_flags: legacyRecovery.missing_history_flags ?? [],
    },
  };
};

const firstDefined = (row: Record<string, unknown>, keys: string[]) => keys.map((key) => row[key]).find((value) => value !== undefined) ?? null;

const historicalEvidence = (rows: Record<string, unknown[]>) => Object.entries(rows).flatMap(([table, sourceRows]) => (sourceRows as Record<string, unknown>[]).map((row) => ({
  table,
  source_id: row.id ?? null,
  recorded_at: typeof row.created_at === 'string' ? row.created_at : null,
  event_at: historicalEventTimestamp(table, row) ?? null,
  available_at: typeof row.historical_available_at === 'string' ? row.historical_available_at : (typeof row.created_at === 'string' ? row.created_at : null),
  deleted_at: typeof row.deleted_at === 'string' ? row.deleted_at : null,
  recovered_version: row.__historical_version_recovered === true ? { version: row.record_version ?? null, available_at: row.historical_available_at ?? null } : null,
})));

const legacyCaseRecovery = async (client: ReturnType<typeof serviceClient>, assignment: Record<string, unknown>, completedAt: string) => {
  const assignmentId = String(assignment.id);
  const roomId = Number(assignment.room_id);
  const explicitCaseVersion = typeof assignment.case_key_version === 'string' && assignment.case_key_version.trim() ? assignment.case_key_version.trim() : null;
  const archiveFlags: string[] = [];
  let assignmentVersions: Array<Record<string, unknown>> = [];
  let authoredVersions: Array<Record<string, unknown>> = [];
  const baselineQuery = await client.from('mar_assignment_baseline_versions').select('assignment_id, case_version, patient_id, room_id, event_snapshot, content_hash, created_at').eq('assignment_id', assignmentId).order('created_at', { ascending: false });
  if (baselineQuery.error) {
    const failure = classifySourceReadError(baselineQuery.error);
    if (failure.category === 'missing_table') { archiveFlags.push('assignment_case_version_archive_unavailable'); assignmentVersions = []; }
    else if (failure.category === 'missing_column') { archiveFlags.push(`assignment_case_version_archive_column_unavailable:${failure.code}`); assignmentVersions = []; }
    else throw new Error(`LEGACY_CASE_ARCHIVE_READ_FAILED:${failure.category}:${failure.code}:${failure.message}`);
  } else assignmentVersions = (baselineQuery.data ?? []) as Array<Record<string, unknown>>;
  const authoredQuery = await client.from('mar_authored_case_versions').select('room_id, patient_id, school_id, case_version, order_snapshot, event_snapshot, content_hash, created_at').eq('room_id', roomId).order('created_at', { ascending: false });
  if (authoredQuery.error) {
    const failure = classifySourceReadError(authoredQuery.error);
    if (failure.category === 'missing_table') { archiveFlags.push('authored_case_version_archive_unavailable'); authoredVersions = []; }
    else if (failure.category === 'missing_column') { archiveFlags.push(`authored_case_version_archive_column_unavailable:${failure.code}`); authoredVersions = []; }
    else throw new Error(`LEGACY_CASE_ARCHIVE_READ_FAILED:${failure.category}:${failure.code}:${failure.message}`);
  } else authoredVersions = (authoredQuery.data ?? []) as Array<Record<string, unknown>>;
  const provenance = resolveLegacyCaseProvenance({
    assignmentRows: assignmentVersions,
    authoredRows: authoredVersions,
    identity: {
      // Never inherit patient/school identity from the current joined room for
      // a legacy assignment: that room may have been edited after completion.
      patientId: typeof assignment.patient_id === 'string' ? assignment.patient_id : null,
      schoolId: typeof assignment.school_id === 'string' ? assignment.school_id : null,
      roomId: Number.isFinite(roomId) ? roomId : null,
      pinnedCaseVersion: explicitCaseVersion,
      identityProvenance: typeof assignment.patient_id === 'string' && typeof assignment.school_id === 'string' ? 'assignment' : 'missing',
    },
    completedAt,
    hasFullScenarioBaseline: Boolean(assignment.scenario_baseline && typeof assignment.scenario_baseline === 'object'),
  });
  return { ...provenance, missing_history_flags: [...archiveFlags, ...provenance.missing_history_flags] };
};

const historicalInputAudit = async (client: ReturnType<typeof serviceClient>, manifest: FacultyStudyManifest) => {
  const results: Array<Record<string, unknown>> = [];
  for (const item of manifest.attempts) {
    const base = { batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, assignment_id: item.assignment_id };
    try {
      const assignmentResult = await client.from('student_room_assignments').select('*, room:room_id (*)').eq('id', item.assignment_id).maybeSingle();
      if (assignmentResult.error) throw new Error(`ASSIGNMENT_READ_FAILED:${assignmentResult.error.message}`);
      if (!assignmentResult.data) throw new Error('ASSIGNMENT_NOT_FOUND');
      const assignment = assignmentResult.data as Record<string, unknown>;
      if (assignment.status !== 'completed') throw new Error('CONTEXT_UNRECOVERABLE:assignment is not completed');
      const completedAt = typeof assignment.completed_at === 'string' ? assignment.completed_at : '';
      if (!completedAt) throw new Error('CONTEXT_UNRECOVERABLE:assignment has no completed_at cutoff');
      const legacyRecovery = await legacyCaseRecovery(client, assignment, completedAt);
      const context = await exactContext(client, item.assignment_id, completedAt);
      const sourceInventory = await historicalSourceInventory(client, assignment, completedAt, legacyRecovery, context);
      const historicalChart = assignment.scenario_baseline && typeof assignment.scenario_baseline === 'object' ? assignment.scenario_baseline as Record<string, unknown> : null;
      const baselineVersion = firstDefined(assignment, ['scenario_baseline_version', 'baseline_version']);
      const progressNoteVersion = firstDefined(assignment, ['student_progress_note_version', 'progress_note_version', 'student_progress_note_revision']);
      const entries = buildAssignmentTimelineEntries({ assignment: { id: String(assignment.id), completed_at: completedAt, student_progress_note: typeof assignment.student_progress_note === 'string' ? assignment.student_progress_note : null }, assignmentId: item.assignment_id, targetRoomIds: null, messages: (context.rows.chat_messages ?? []) as TimelineChatMessageRow[], orders: (context.rows.medical_orders ?? []) as TimelineOrderRow[], labs: (context.rows.lab_results ?? []) as TimelineLabRow[], vitals: (context.rows.vital_signs ?? []) as TimelineVitalRow[], imaging: (context.rows.imaging_studies ?? []) as TimelineImagingRow[], learnerActions: (context.rows.learner_action_events ?? []) as TimelineLearnerActionRow[], patientMessages: (context.rows.patient_chat_messages ?? []) as TimelinePatientMessageRow[], consultantMessages: (context.rows.consultant_chat_messages ?? []) as TimelineConsultantMessageRow[] });
      const caseKey = historicalChart ? resolveCaseEvaluationKey(historicalChart) : { version: legacyRecovery.resolved_case_version ?? (typeof assignment.case_key_version === 'string' ? assignment.case_key_version : CASE_KEY_VERSION) };
      results.push({
        ...base,
        status: 'audited',
        assignment: { id: assignment.id, room_id: assignment.room_id ?? null, status: assignment.status, completed_at: completedAt },
        case: { specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, key_version: caseKey.version || CASE_KEY_VERSION },
        baseline: { value: historicalChart, version: baselineVersion, source: historicalChart ? 'student_room_assignments.scenario_baseline' : null },
        legacy_case_recovery: legacyRecovery,
        progress_note: { value: assignment.student_progress_note ?? null, version: progressNoteVersion, recorded_at: firstDefined(assignment, ['student_progress_note_created_at', 'progress_note_created_at']), updated_at: firstDefined(assignment, ['student_progress_note_updated_at', 'progress_note_updated_at']) },
        evidence: historicalEvidence(context.rows),
        evidence_ids: [...new Set(Object.values(context.rows).flatMap((rows) => (rows as Record<string, unknown>[]).map((row) => row.id).filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')).map(String))],
        availability: context.availability,
        source_inventory: sourceInventory,
        missing_history_flags: [
          ...(baselineVersion === null ? ['baseline_version_unavailable'] : []),
          ...legacyRecovery.missing_history_flags,
          ...(progressNoteVersion === null ? ['progress_note_version_unavailable'] : []),
          ...((context.availability as { missing_historical_version?: unknown[] }).missing_historical_version ?? []).map((entry) => ({ kind: 'historical_version_unavailable', ...entry as Record<string, unknown> })),
        ],
        final_evaluation_timeline: entries,
        rendered_evaluation_timeline: renderTimelineEntriesForEvaluation(entries),
      });
    } catch (error) {
      results.push({ ...base, status: 'error', error: { code: errorCode(error) || message(error).split(':')[0], message: message(error), phase: 'historical-input-audit', retryable: false } });
    }
  }
  const promptTextHash = await sha256(manifest.prompt_text);
  const canonicalPromptHash = await sha256(`${EVALUATION_SYSTEM_PROMPT}\n\n${CANONICAL_RUBRIC}`);
  const manifestHash = await sha256(JSON.stringify(manifest));
  return {
    action: 'model_free_historical_input_audit',
    deployment_mode: deploymentMode(),
    batch_key: manifest.batch_key,
    manifest_sha256: manifestHash,
    protocol_version: FACULTY_STUDY_PROTOCOL_VERSION,
    prompt_provenance: { prompt_version: manifest.prompt_version, supplied_prompt_sha256: promptTextHash, canonical_prompt_sha256: canonicalPromptHash, rubric_version: FEEDBACK_RUBRIC_VERSION, assessment_version: ASSESSMENT_VERSION, case_key_version: CASE_KEY_VERSION, expected_model: manifest.expected_model, active_evaluator_config: null, scoring_anchors: null },
    attempt_count: manifest.attempts.length,
    audited_count: results.filter((result) => result.status === 'audited').length,
    error_count: results.filter((result) => result.status === 'error').length,
    model_calls: 0,
    learner_writes: 0,
    study_writes: 0,
    results,
  };
};

const missingStudyTable = (error: { code?: string; message?: string } | null) => classifySourceReadError(error).category === 'missing_table';

const studyHistory = async (client: ReturnType<typeof serviceClient>, assignmentId: string) => {
  if (!assignmentId.trim()) throw new Error('STUDY_ASSIGNMENT_ID_REQUIRED');
  const resultQuery = await client.from('faculty_study_results').select('batch_id, batch_ordinal, result, canonical_result, error, generated_at, prompt_version, model, created_at').eq('assignment_id', assignmentId).order('created_at', { ascending: false });
  if (missingStudyTable(resultQuery.error)) return { action: 'study_history', assignment_id: assignmentId, available: false, reason: 'study_tables_not_applied', batches: [], versions: [] };
  if (resultQuery.error) throw resultQuery.error;
  const rows = resultQuery.data ?? [];
  const batchIds = [...new Set(rows.map((row) => row.batch_id))];
  if (!batchIds.length) {
    const batchesQuery = await client.from('faculty_study_batches').select('id, batch_key, status, prompt_version, model, created_at, completed_at, manifest').order('created_at', { ascending: false });
    if (missingStudyTable(batchesQuery.error)) return { action: 'study_history', assignment_id: assignmentId, available: false, reason: 'study_tables_not_applied', batches: [], versions: [] };
    if (batchesQuery.error) throw batchesQuery.error;
    const matchingBatches = (batchesQuery.data ?? []).filter((batch) => {
      const manifest = batch.manifest as { attempts?: Array<{ assignment_id?: string }> } | null;
      return manifest?.attempts?.some((attempt) => attempt.assignment_id === assignmentId);
    }).map((batch) => {
      const manifest = validateStudyManifest(batch.manifest);
      const totalCount = manifest.target_ordinals?.length ?? manifest.attempts.length;
      return { id: batch.id, batch_key: batch.batch_key, status: batch.status, prompt_version: batch.prompt_version, model: batch.model, generator_revision: null, created_at: batch.created_at, completed_at: batch.completed_at, total_count: totalCount, completed_count: 0, error_count: 0, pending_count: totalCount, progress_status: batch.status };
    });
    return { action: 'study_history', assignment_id: assignmentId, available: true, batches: matchingBatches, versions: [] };
  }
  const [batchesQuery, allResultsQuery] = await Promise.all([
    client.from('faculty_study_batches').select('id, batch_key, status, prompt_version, model, generator_revision, created_at, completed_at, manifest').in('id', batchIds),
    client.from('faculty_study_results').select('batch_id, batch_ordinal, result, canonical_result, error').in('batch_id', batchIds),
  ]);
  if (missingStudyTable(batchesQuery.error) || missingStudyTable(allResultsQuery.error)) return { action: 'study_history', assignment_id: assignmentId, available: false, reason: 'study_tables_not_applied', batches: [], versions: [] };
  if (batchesQuery.error) throw batchesQuery.error;
  if (allResultsQuery.error) throw allResultsQuery.error;
  const batchById = new Map((batchesQuery.data ?? []).map((batch) => [batch.id, batch]));
  const allByBatch = new Map<string, typeof allResultsQuery.data>();
  for (const row of allResultsQuery.data ?? []) allByBatch.set(row.batch_id, [...(allByBatch.get(row.batch_id) ?? []), row]);
  const storedResultStatus = (row: { result?: unknown; canonical_result?: unknown; error?: unknown }) => {
    if (row.error) return 'error';
    const value = row.canonical_result && typeof row.canonical_result === 'object' ? row.canonical_result : row.result && typeof row.result === 'object' && 'evaluation' in row.result && row.result.evaluation && typeof row.result.evaluation === 'object' ? row.result.evaluation : null;
    return value && hasValidSixComponentEvaluation(value as Record<string, unknown>) ? 'completed' : 'pending';
  };
  const batches = [...batchById.values()].map((batch) => {
    const batchRows = allByBatch.get(batch.id) ?? [];
    const batchManifest = validateStudyManifest(batch.manifest);
    const scopedOrdinals = new Set(batchManifest.target_ordinals ?? batchManifest.attempts.map((item) => item.batch_ordinal));
    const scopedRows = batchRows.filter((row) => scopedOrdinals.has(row.batch_ordinal));
    const completedCount = scopedRows.filter((row) => storedResultStatus(row) === 'completed').length;
    const errorCount = scopedRows.filter((row) => storedResultStatus(row) === 'error').length;
    const totalCount = scopedOrdinals.size;
    const publicBatch = Object.fromEntries(Object.entries(batch).filter(([key]) => key !== 'manifest'));
    return { ...publicBatch, total_count: totalCount, completed_count: completedCount, error_count: errorCount, pending_count: totalCount - completedCount - errorCount, progress_status: batch.status === 'completed' && completedCount === totalCount && errorCount === 0 ? 'completed' : completedCount + errorCount > 0 ? 'partial' : batch.status };
  });
  const versions = rows.map((row) => {
    const batch = batchById.get(row.batch_id);
    const status = storedResultStatus(row);
    return { batch_id: row.batch_id, batch_key: batch?.batch_key ?? null, batch_ordinal: row.batch_ordinal, status, downloadable: status === 'completed', prompt_version: row.prompt_version, model: row.model, generated_at: row.generated_at, created_at: row.created_at, batch_status: batch?.status ?? null };
  });
  return { action: 'study_history', assignment_id: assignmentId, available: true, batches, versions };
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
  const room = assignment.scenario_baseline as Record<string, unknown>;
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

const schemaReadiness = async (client: ReturnType<typeof serviceClient>) => {
  const checks = [
    ['student_room_assignments', ['id', 'room_id', 'student_id', 'status', 'completed_at', 'student_progress_note', ...STUDY_ASSIGNMENT_PROTECTED_FIELDS]],
    ['faculty_study_batches', ['id', 'manifest', 'status', 'lease_token', 'lease_expires_at']],
    ['faculty_study_results', ['batch_id', 'batch_ordinal', 'result', 'canonical_result', 'raw_model_response', 'error', 'lease_token']],
    ['feedback_evaluator_configs', ['id', 'version', 'evaluator_prompt', 'scoring_anchors', 'scope', 'room_id', 'status']],
    ...['chat_messages', 'medical_orders', 'lab_results', 'vital_signs', 'imaging_studies', 'learner_action_events', 'patient_chat_messages', 'consultant_chat_messages'].map((table) => [table, ['assignment_id']]),
  ] as Array<[string, string[]]>;
  const results = await Promise.all(checks.map(async ([table, columns]) => {
    const probe = await client.from(table).select(columns.join(',')).limit(0);
    return { table, columns, ready: !probe.error, error: probe.error?.message ?? null };
  }));
  const versionProbe = await client.from('imaging_study_versions').select('id, study_id, version, created_at, encounter_time').limit(0);
  results.push({ table: 'imaging_study_versions', columns: ['id', 'study_id', 'version', 'created_at', 'encounter_time'], ready: !versionProbe.error, error: versionProbe.error?.message ?? null });
  return { ready: results.filter((check) => check.table !== 'imaging_study_versions').every((check) => check.ready), version_recovery_supported: !versionProbe.error, checks: results };
};

const preflight = async (client: ReturnType<typeof serviceClient>, manifest: FacultyStudyManifest) => {
  const assignmentsResult = await client.from('student_room_assignments').select('*').in('id', manifest.attempts.map((item) => item.assignment_id));
  const assignments = new Map((assignmentsResult.data ?? []).map((assignment) => [String(assignment.id), assignment as Record<string, unknown>]));
  const runtime = await inspectRuntime(client, manifest);
  const foundCount = manifest.attempts.filter((item) => assignments.has(item.assignment_id)).length;
  const backupErrors = assignmentsResult.error ? [{ code: 'FEEDBACK_BACKUP_READ_FAILED', message: assignmentsResult.error.message }] : [];
  const backupReady = !assignmentsResult.error && foundCount === manifest.attempts.length;
  const schema = await schemaReadiness(client);
  return {
    action: 'model_free_preflight',
    deployment_mode: deploymentMode(),
    batch_key: manifest.batch_key,
    attempt_count: manifest.attempts.length,
    model_calls: 0,
    learner_writes: 0,
    readiness: { ready: schema.ready && runtime.ready && backupReady, schema: schema.ready, runtime: runtime.ready, backups: backupReady },
    schema,
    runtime,
    feedback_backup_readiness: { ready: backupReady, found_count: foundCount, error_count: manifest.attempts.length - foundCount, errors: backupErrors },
    raw_feedback_backups: manifest.attempts.map((item) => buildStudyFeedbackBackup(item, assignments.get(item.assignment_id) ?? null)),
  };
};

const privateTermsForAssignment = async (client: ReturnType<typeof serviceClient>, assignment: Record<string, unknown>) => {
  const terms: string[] = [];
  const roomId = Number(assignment.room_id);
  const patient = await client.from('patients').select('first_name, last_name, mrn').eq('room_id', roomId).limit(1).maybeSingle();
  if (patient.error) throw new Error(`IDENTITY_REDACTION_UNAVAILABLE:patient lookup failed:${patient.error.message}`);
  if (!patient.data) throw new Error('IDENTITY_REDACTION_UNAVAILABLE:patient identity was not found');
  terms.push(patient.data.first_name, patient.data.last_name, patient.data.mrn);
  const student = typeof assignment.student_id === 'string' ? await client.from('profiles').select('full_name, email').eq('id', assignment.student_id).maybeSingle() : { data: null, error: null };
  if (student.error) throw new Error(`IDENTITY_REDACTION_UNAVAILABLE:student lookup failed:${student.error.message}`);
  if (!student.data) throw new Error('IDENTITY_REDACTION_UNAVAILABLE:student identity was not found');
  terms.push(student.data.full_name, student.data.email);
  if (typeof student.data.full_name === 'string') terms.push(...student.data.full_name.split(/\s+/));
  return terms.filter((term): term is string => typeof term === 'string' && term.trim().length > 1);
};

const assertProtectedAssignmentReadback = async (client: ReturnType<typeof serviceClient>, assignmentId: string, before: Record<string, unknown>) => {
  const readback = await client.from('student_room_assignments').select('*').eq('id', assignmentId).maybeSingle();
  if (readback.error) throw readback.error;
  if (!readback.data || !protectedAssignmentUnchanged(before, readback.data as Record<string, unknown>)) throw new Error('STUDY_PROTECTED_ASSIGNMENT_CHANGED: feedback/status/grade readback differs from the frozen pre-model snapshot');
};

const run = async (client: ReturnType<typeof serviceClient>, batchId: string, requestedLimit: unknown, requestedOrdinals: unknown) => {
  const batchResult = await client.from('faculty_study_batches').select('*').eq('id', batchId).single();
  if (batchResult.error) throw batchResult.error;
  const batch = batchResult.data as Record<string, unknown>;
  const manifest = validateStudyManifest(batch.manifest);
  const model = String(batch.model);
  const limit = Math.max(1, Math.min(30, Number.isInteger(Number(requestedLimit)) ? Number(requestedLimit) : 5));
  const existingResult = await client.from('faculty_study_results').select('batch_ordinal, result, error').eq('batch_id', batchId);
  if (existingResult.error) throw existingResult.error;
  const doneOrdinals = new Set((existingResult.data ?? []).filter((row) => isTerminalStudyResult(row)).map((row) => row.batch_ordinal));
  const resolvedTargetOrdinals = resolveStudyTargetOrdinals(manifest.target_ordinals, requestedOrdinals);
  const targetOrdinals = resolvedTargetOrdinals ? new Set(resolvedTargetOrdinals) : null;
  const scopedOrdinals = targetOrdinals ?? new Set(manifest.attempts.map((item) => item.batch_ordinal));
  const pending = manifest.attempts.filter((item) => !doneOrdinals.has(item.batch_ordinal) && (!targetOrdinals || targetOrdinals.has(item.batch_ordinal))).slice(0, limit);
  if (pending.length === 0) {
    const progress = studyProgress(existingResult.data ?? [], scopedOrdinals);
    return { batch_id: batchId, learner_writes: 0, result_writes: progress.completedCount, status: progress.pendingCount === 0 && progress.errorCount === 0 ? 'completed' : progress.errorCount > 0 && progress.pendingCount === 0 ? 'error' : 'partial', progress: { completed_count: progress.completedCount, error_count: progress.errorCount, pending_count: progress.pendingCount, total_count: progress.totalCount, remaining_count: progress.pendingCount }, target_ordinals: targetOrdinals ? [...targetOrdinals] : null };
  }
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + STUDY_RUN_LEASE_MS).toISOString();
  const leaseToken = crypto.randomUUID();
  const stale = await client.from('faculty_study_batches')
    .update({ status: 'prepared', started_at: null, completed_at: null, lease_token: null, lease_expires_at: null, error: { code: 'STUDY_RUN_LEASE_EXPIRED', message: 'Recovered an interrupted study run before resuming.' } })
    .eq('id', batchId)
    .eq('status', 'running')
    .or(`lease_expires_at.lte.${nowIso},and(lease_expires_at.is.null,started_at.lte.${nowIso}),and(lease_expires_at.is.null,started_at.is.null)`)
    .select('id')
    .maybeSingle();
  if (stale.error) throw stale.error;
  const claim = await client.from('faculty_study_batches').update({ status: 'running', started_at: nowIso, completed_at: null, lease_token: leaseToken, lease_expires_at: leaseExpiresAt, error: null }).eq('id', batchId).in('status', ['prepared', 'failed']).select('id').maybeSingle();
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
      if (!assignment.scenario_baseline || typeof assignment.scenario_baseline !== 'object') throw new Error('CONTEXT_UNRECOVERABLE:HISTORICAL_CHART_BASELINE_MISSING');
      const completedAt = typeof assignment.completed_at === 'string' ? assignment.completed_at : '';
      if (!completedAt) throw new Error('CONTEXT_UNRECOVERABLE:assignment has no completed_at cutoff');
      const context = await exactContext(client, item.assignment_id, completedAt);
      const attestation = (batch.attempt_attestations as Array<Record<string, unknown>>).find((candidate) => candidate.batch_ordinal === item.batch_ordinal) ?? {};
      const sourceHashes = { context_sha256: await sha256(JSON.stringify(context)), assignment_snapshot_sha256: await sha256(JSON.stringify(snapshot)) };
      if (!assignment.scenario_baseline || typeof assignment.scenario_baseline !== 'object') throw new Error('CONTEXT_UNRECOVERABLE:HISTORICAL_CHART_BASELINE_MISSING');
      const historicalChart = assignment.scenario_baseline as Record<string, unknown>;
      frozenInput = { assignment_snapshot: snapshot, context, chart_reconstruction: historicalChart, source_hashes: sourceHashes, redaction_terms: privateTerms, case_key: resolveCaseEvaluationKey(historicalChart), evaluator: { prompt: attestation.evaluator_prompt, scoring_anchors: attestation.scoring_anchors }, rubric_version: FEEDBACK_RUBRIC_VERSION, assessment_version: ASSESSMENT_VERSION };
      await writeOwnedFacultyStudyResult(client, { batchId, batchOrdinal: item.batch_ordinal, leaseToken, assignmentId: item.assignment_id, historicalSnapshot: snapshot, frozenInput, result: null, canonicalResult: null, rawModelResponse: null, error: null, promptVersion: String(batch.prompt_version), model, generatedAt: null });
      const evaluation = await evaluate(manifest, item, assignment, context, model, { evaluator_prompt: attestation.evaluator_prompt, scoring_anchors: attestation.scoring_anchors });
      rawModelResponse = evaluation.raw;
      await assertProtectedAssignmentReadback(client, item.assignment_id, { ...assignment, status: snapshot.status });
      result = { batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, status: 'completed', evaluation: evaluation.canonical, evidence_event_ids: evaluation.evidenceEventIds, generated_at: new Date().toISOString(), prompt_version: batch.prompt_version, model, redaction_terms: privateTerms };
      await writeOwnedFacultyStudyResult(client, { batchId, batchOrdinal: item.batch_ordinal, leaseToken, assignmentId: item.assignment_id, historicalSnapshot: snapshot, frozenInput, result, canonicalResult: evaluation.canonical as unknown as Record<string, unknown>, rawModelResponse: evaluation.raw, error: null, promptVersion: String(batch.prompt_version), model, generatedAt: String(result.generated_at) });
    } catch (error) {
      if (message(error) === 'STUDY_RUN_LEASE_LOST') throw error;
      result.error = { code: errorCode(error) || message(error).split(':')[0], message: message(error), phase: 'attempt', retryable: false };
      if (snapshot.assignment_id) {
        try { await assertProtectedAssignmentReadback(client, item.assignment_id, { ...snapshot, ...snapshot.existing_feedback as Record<string, unknown> }); }
        catch (readbackError) { result.error = { code: errorCode(readbackError) || message(readbackError).split(':')[0], message: message(readbackError), phase: 'protection-readback', retryable: false }; }
      }
      await writeOwnedFacultyStudyResult(client, { batchId, batchOrdinal: item.batch_ordinal, leaseToken, assignmentId: item.assignment_id, historicalSnapshot: snapshot, frozenInput, result: null, canonicalResult: null, rawModelResponse, error: result.error as Record<string, unknown>, promptVersion: String(batch.prompt_version), model, generatedAt: null });
    }
  }
    const refreshed = await client.from('faculty_study_results').select('batch_ordinal, result, error').eq('batch_id', batchId);
    if (refreshed.error) throw refreshed.error;
    const progress = studyProgress(refreshed.data ?? [], scopedOrdinals);
    const finished = progress.pendingCount === 0 && progress.errorCount === 0;
    const done = await client.from('faculty_study_batches').update({ status: finished ? 'completed' : 'prepared', completed_at: finished ? new Date().toISOString() : null, lease_token: null, lease_expires_at: null, next_batch_ordinal: finished ? null : manifest.attempts.find((item) => scopedOrdinals.has(item.batch_ordinal) && !(refreshed.data ?? []).some((row) => row.batch_ordinal === item.batch_ordinal && isTerminalStudyResult(row)))?.batch_ordinal ?? null }).eq('id', batchId).eq('status', 'running').eq('lease_token', leaseToken).select('id').maybeSingle();
    if (done.error) throw done.error;
    if (!done.data) throw new Error('STUDY_RUN_LEASE_LOST');
    return { batch_id: batchId, learner_writes: 0, result_writes: progress.completedCount, status: finished ? 'completed' : progress.errorCount > 0 && progress.pendingCount === 0 ? 'error' : 'partial', progress: { completed_count: progress.completedCount, error_count: progress.errorCount, pending_count: progress.pendingCount, total_count: progress.totalCount, remaining_count: progress.pendingCount }, target_ordinals: targetOrdinals ? [...targetOrdinals] : null };
  } catch (error) {
    await client.from('faculty_study_batches').update({ status: 'failed', completed_at: new Date().toISOString(), lease_token: null, lease_expires_at: null, error: { code: errorCode(error), message: message(error) } }).eq('id', batchId).eq('status', 'running').eq('lease_token', leaseToken);
    throw error;
  }
};

const exportBatch = async (client: ReturnType<typeof serviceClient>, batchId: string, requestedOrdinal: unknown, requestedAssignmentId: unknown) => {
  const [batchResult, resultsResult] = await Promise.all([client.from('faculty_study_batches').select('id, batch_key, manifest, prompt_version, model, generator_revision, evaluator_config_revision, protocol_version, created_at, attempt_attestations').eq('id', batchId).single(), client.from('faculty_study_results').select('batch_ordinal, assignment_id, historical_snapshot, frozen_input, canonical_result, raw_model_response, result, error, generated_at, prompt_version, model').eq('batch_id', batchId).order('batch_ordinal')]);
  if (batchResult.error) throw batchResult.error;
  if (resultsResult.error) throw resultsResult.error;
  const resultByCase = new Map((resultsResult.data ?? []).map((row) => [row.batch_ordinal, row]));
  const manifest = validateStudyManifest((batchResult.data as Record<string, unknown>).manifest);
  const selectedOrdinal = requestedOrdinal === undefined || requestedOrdinal === null ? null : Number(requestedOrdinal);
  if (selectedOrdinal !== null && (!Number.isInteger(selectedOrdinal) || selectedOrdinal < 1 || selectedOrdinal > 30)) throw new Error('STUDY_BATCH_ORDINAL_INVALID');
  const selectedAttempts = selectedOrdinal === null ? manifest.attempts : manifest.attempts.filter((item) => item.batch_ordinal === selectedOrdinal);
  const results = selectedAttempts.map((item) => {
    const row = resultByCase.get(item.batch_ordinal);
    const errorReviewer = (error: unknown, rowData?: Record<string, unknown>) => deidentifyStudyResult({ batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, status: 'error', communication_score: null, component_scores: {}, error, generated_at: rowData?.generated_at ?? null, prompt_version: rowData?.prompt_version ?? batchResult.data.prompt_version, model: rowData?.model ?? batchResult.data.model, redaction_terms: ((rowData?.frozen_input as Record<string, unknown> | null)?.redaction_terms as string[] | undefined) ?? [] }) as Record<string, unknown>;
    if (!row) return errorReviewer({ code: 'STUDY_RESULT_MISSING', message: 'No isolated result was recorded for this batch ordinal.', phase: 'export', retryable: false });
    if (row.assignment_id !== item.assignment_id || (requestedAssignmentId !== undefined && requestedAssignmentId !== null && String(row.assignment_id) !== String(requestedAssignmentId))) return errorReviewer({ code: 'STUDY_RESULT_ASSIGNMENT_MISMATCH', message: 'The stored result does not match the requested assignment.', phase: 'export', retryable: false }, row as Record<string, unknown>);
    if (row.error || !row.result) return errorReviewer(row.error ?? { code: 'STUDY_RESULT_NOT_COMPLETED', message: 'The isolated result is still pending and cannot be downloaded.', phase: 'export', retryable: true }, row as Record<string, unknown>);
    const storedEvaluation = row.canonical_result && typeof row.canonical_result === 'object' ? row.canonical_result as Record<string, unknown> : row.result && typeof row.result === 'object' && 'evaluation' in row.result && row.result.evaluation && typeof row.result.evaluation === 'object' ? row.result.evaluation as Record<string, unknown> : null;
    if (!storedEvaluation || !hasValidSixComponentEvaluation(storedEvaluation)) return errorReviewer({ code: 'STUDY_RESULT_INVALID', message: 'The stored result does not satisfy the six-component contract.', phase: 'export', retryable: false }, row as Record<string, unknown>);
    const privateTerms = ((row.frozen_input as Record<string, unknown> | null)?.redaction_terms as string[] | undefined) ?? [];
    const canonical = row.result && typeof row.result === 'object' ? row.result as Record<string, unknown> : { batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, status: row.error ? 'error' : 'completed' };
    const reviewerCanonical = deidentifyStudyResult({ ...canonical, batch_ordinal: item.batch_ordinal, specialty: item.specialty, case_label: item.case_label, packet_label: item.packet_label, status: studyResultStatus(row), error: row.error, redaction_terms: privateTerms });
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
      case_count: results.length,
      batch_ordinals: results.map((item) => item.batch_ordinal),
    },
    results,
  };
  const sheet = [STUDY_SHEET_COLUMNS.join(','), ...results.map((row) => studySheetRow(row).map(csvEscape).join(','))].join('\n');
  const documents = results.flatMap((row) => [
    { filename: `batch-${String(row.batch_ordinal).padStart(2, '0')}-evaluation.json`, content: JSON.stringify(row, null, 2) },
    { filename: `batch-${String(row.batch_ordinal).padStart(2, '0')}-evaluation.html`, content: buildEvaluationSheetHtml(row) },
  ]);
  const selectedOrdinals = new Set(results.map((row) => row.batch_ordinal));
  const coordinator = (resultsResult.data ?? []).filter((row) => selectedOrdinals.has(row.batch_ordinal)).map((row) => ({ batch_ordinal: row.batch_ordinal, assignment_id: row.assignment_id, historical_snapshot: row.historical_snapshot, frozen_input: row.frozen_input, canonical_result: row.canonical_result, raw_model_response: row.raw_model_response, error: row.error, generated_at: row.generated_at, prompt_version: row.prompt_version, model: row.model }));
  return { raw, sheet, documents, coordinator, learner_writes: 0 };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const requestId = crypto.randomUUID();
  try {
    const client = serviceClient();
    const userId = await requireAdmin(req, client, requestId);
    const body = await req.json() as Record<string, unknown>;
    const action = body.action;
    if (!studyActionAllowed(String(action), deploymentMode())) throw new Error(`STUDY_PREFLIGHT_ONLY: ${String(action)} is disabled while the deployment is preflight-only`);
    if (action === 'preflight') return json(await preflight(client, validateStudyManifest(body.manifest)), 200, requestId);
    if (action === 'audit') return json(await historicalInputAudit(client, validateStudyManifest(body.manifest)), 200, requestId);
    if (action === 'history') return json(await studyHistory(client, String(body.assignment_id ?? '')), 200, requestId);
    if (action === 'prepare') return json(await prepare(client, userId, validateStudyManifest(body.manifest)), 200, requestId);
    if (action === 'run') return json(await run(client, String(body.batch_id), body.max_cases, body.target_ordinals), 200, requestId);
    if (action === 'export') return json(await exportBatch(client, String(body.batch_id), body.batch_ordinal, body.assignment_id), 200, requestId);
    throw new Error('STUDY_ACTION_INVALID');
  } catch (error) {
    const status = /AUTH|REQUIRED|INVALID|UNAVAILABLE|MISMATCH|UNVERIFIED|PREFLIGHT/.test(message(error)) ? 400 : 500;
    return json({ error: { code: errorCode(error) || message(error).split(':')[0], message: message(error), request_id: requestId } }, status, requestId);
  }
});
