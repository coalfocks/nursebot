export const FACULTY_STUDY_PROTOCOL_VERSION = 'faculty-study-v1';
export type FacultyStudyDeploymentMode = 'study-enabled' | 'preflight-only';
export const studyActionAllowed = (action: string, mode: FacultyStudyDeploymentMode) => mode !== 'preflight-only' || action === 'preflight' || action === 'audit' || action === 'export';

export type StudyManifestItem = {
  batch_ordinal: number;
  specialty: string;
  case_label: string;
  packet_label: string;
  assignment_id: string;
};

export type FacultyStudyManifest = {
  batch_key: string;
  prompt_version: string;
  prompt_text: string;
  expected_model: string;
  attempts: StudyManifestItem[];
};

export const STUDY_ASSIGNMENT_PROTECTED_FIELDS = [
  'feedback_status',
  'feedback_error',
  'grade',
  'nurse_feedback',
  'feedback_debrief',
  'communication_score',
  'mdm_score',
  'communication_breakdown',
  'mdm_breakdown',
  'learning_objectives',
  'feedback_generated_at',
  'scoring_start_at',
  'rubric_version',
  'case_key_version',
  'assessment_version',
  'source_event_ids',
  'technical_incomplete',
  'safety_result',
] as const;

export const snapshotAssignmentProtection = (assignment: Record<string, unknown>) =>
  Object.fromEntries(STUDY_ASSIGNMENT_PROTECTED_FIELDS.map((field) => [field, assignment[field] ?? null]));

export const buildStudyFeedbackBackup = (item: StudyManifestItem, assignment: Record<string, unknown> | null) => ({
  batch_ordinal: item.batch_ordinal,
  specialty: item.specialty,
  case_label: item.case_label,
  packet_label: item.packet_label,
  assignment_id: item.assignment_id,
  found: Boolean(assignment),
  status: assignment?.status ?? null,
  completed_at: assignment?.completed_at ?? null,
  room_id: assignment?.room_id ?? null,
  raw_feedback_backup: assignment ? snapshotAssignmentProtection(assignment) : null,
});

export const protectedAssignmentUnchanged = (before: Record<string, unknown>, after: Record<string, unknown>) =>
  before.status === after.status
  && JSON.stringify(snapshotAssignmentProtection(before)) === JSON.stringify(snapshotAssignmentProtection(after));

export const isTerminalStudyResult = (row: { result?: unknown; error?: unknown }) => Boolean(row.result || row.error);
export const studyResultStatus = (row: { result?: unknown; error?: unknown }) => row.result ? 'completed' : row.error ? 'error' : 'pending';
export const STUDY_RUN_LEASE_MS = 15 * 60 * 1000;
export const isStudyRunLeaseExpired = (leaseExpiresAt: unknown, now = Date.now()) =>
  typeof leaseExpiresAt === 'string' && Number.isFinite(new Date(leaseExpiresAt).getTime()) && new Date(leaseExpiresAt).getTime() <= now;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const validateStudyManifest = (value: unknown): FacultyStudyManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('STUDY_MANIFEST_INVALID: expected an object');
  const source = value as Record<string, unknown>;
  const text = (key: string) => typeof source[key] === 'string' ? String(source[key]).trim() : '';
  const batchKey = text('batch_key');
  const promptVersion = text('prompt_version');
  const promptText = text('prompt_text');
  const expectedModel = text('expected_model');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,95}$/.test(batchKey)) throw new Error('STUDY_MANIFEST_INVALID: batch_key must be stable and opaque');
  if (!promptVersion || !promptText || !expectedModel) throw new Error('STUDY_MANIFEST_INVALID: prompt_version, prompt_text, and expected_model are required');
  if (promptText.length > 100_000) throw new Error('STUDY_MANIFEST_INVALID: prompt_text is too large');
  if (!Array.isArray(source.attempts) || source.attempts.length !== 30) throw new Error('STUDY_MANIFEST_INVALID: exactly 30 attempts are required');
  const attempts = source.attempts.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`STUDY_MANIFEST_INVALID: attempt ${index + 1} is not an object`);
    const row = item as Record<string, unknown>;
    const batchOrdinal = row.batch_ordinal;
    const specialty = typeof row.specialty === 'string' ? row.specialty.trim() : '';
    const caseLabel = typeof row.case_label === 'string' ? row.case_label.trim() : '';
    const packetLabel = typeof row.packet_label === 'string' ? row.packet_label.trim() : '';
    const assignmentId = typeof row.assignment_id === 'string' ? row.assignment_id.trim() : '';
    if (typeof batchOrdinal !== 'number' || !Number.isInteger(batchOrdinal) || batchOrdinal < 1 || batchOrdinal > 30) throw new Error(`STUDY_MANIFEST_INVALID: invalid batch ordinal at position ${index + 1}`);
    if (!specialty || !caseLabel || !packetLabel) throw new Error(`STUDY_MANIFEST_INVALID: specialty, case_label, and packet_label are required at batch ordinal ${batchOrdinal}`);
    if (specialty.length > 120 || caseLabel.length > 160 || packetLabel.length > 160) throw new Error(`STUDY_MANIFEST_INVALID: study labels are too long at batch ordinal ${batchOrdinal}`);
    if (!UUID.test(assignmentId)) throw new Error(`STUDY_MANIFEST_INVALID: invalid assignment id at batch ordinal ${batchOrdinal}`);
    return { batch_ordinal: batchOrdinal, specialty: specialty, case_label: caseLabel, packet_label: packetLabel, assignment_id: assignmentId };
  });
  const numbers = attempts.map((item) => item.batch_ordinal);
  if (new Set(numbers).size !== 30 || numbers.some((number, index) => number !== index + 1)) throw new Error('STUDY_MANIFEST_INVALID: batch_ordinal must contain 1 through 30 in order');
  if (new Set(attempts.map((item) => item.assignment_id)).size !== 30) throw new Error('STUDY_MANIFEST_INVALID: assignment ids must be unique');
  return { batch_key: batchKey, prompt_version: promptVersion, prompt_text: promptText, expected_model: expectedModel, attempts };
};

const scrub = (value: unknown, privateTerms: string[]): unknown => {
  if (typeof value !== 'string') return Array.isArray(value) ? value.map((item) => scrub(item, privateTerms)) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item, privateTerms)])) : value;
  let text = value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[redacted-id]')
    .replace(/\b(?:\+?\d[\d(). -]{7,}\d)\b/g, '[redacted-phone]');
  for (const term of privateTerms.filter((item) => item.length >= 2)) text = text.replace(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[redacted-name]');
  return text;
};

export const redactStudyValue = (value: unknown, privateTerms: string[] = []) => scrub(value, privateTerms);

export const deidentifyStudyResult = (result: Record<string, unknown>) => {
  const flat = !result.evaluation && ('component_scores' in result || 'communication_score' in result);
  if (flat) {
    const privateTerms = (result.redaction_terms as string[] | undefined) ?? [];
    return {
      batch_ordinal: result.batch_ordinal,
      specialty: result.specialty,
      case_label: result.case_label,
      packet_label: result.packet_label,
      status: result.status,
      strengths: redactStudyValue(result.strengths ?? [], privateTerms),
      improvements: redactStudyValue(result.improvements ?? [], privateTerms),
      recommendations: redactStudyValue(result.recommendations ?? [], privateTerms),
      communication_score: result.communication_score ?? null,
      clinical_reasoning_score: result.clinical_reasoning_score ?? null,
      component_scores: result.component_scores ?? {},
      domain_scores: result.domain_scores ?? { communication: result.communication_score ?? null, clinical_reasoning: result.clinical_reasoning_score ?? null },
      communication_breakdown: redactStudyValue(result.communication_breakdown ?? null, privateTerms),
      clinical_reasoning_breakdown: redactStudyValue(result.clinical_reasoning_breakdown ?? null, privateTerms),
      evidence_event_ids: result.evidence_event_ids ?? [],
      generated_at: result.generated_at ?? null,
      prompt_version: result.prompt_version ?? null,
      model: result.model ?? null,
      error: redactStudyValue(result.error ?? null, privateTerms),
    };
  }
  const evaluation = result.evaluation && typeof result.evaluation === 'object' ? result.evaluation as Record<string, unknown> : {};
  const communication = evaluation.communication_breakdown && typeof evaluation.communication_breakdown === 'object' ? evaluation.communication_breakdown as Record<string, unknown> : {};
  const reasoning = (evaluation.clinical_reasoning_breakdown ?? evaluation.mdm_breakdown) && typeof (evaluation.clinical_reasoning_breakdown ?? evaluation.mdm_breakdown) === 'object'
    ? (evaluation.clinical_reasoning_breakdown ?? evaluation.mdm_breakdown) as Record<string, unknown> : {};
  const score = (group: Record<string, unknown>, key: string) => {
    const component = group[key];
    return component && typeof component === 'object' ? (component as Record<string, unknown>).score ?? null : null;
  };
  return {
    batch_ordinal: result.batch_ordinal,
    specialty: result.specialty,
    case_label: result.case_label,
    packet_label: result.packet_label,
    status: result.status,
    strengths: redactStudyValue(evaluation.strengths ?? [], (result.redaction_terms as string[] | undefined) ?? []),
    improvements: redactStudyValue(evaluation.improvements ?? [], (result.redaction_terms as string[] | undefined) ?? []),
    recommendations: redactStudyValue(evaluation.recommendations ?? [], (result.redaction_terms as string[] | undefined) ?? []),
    communication_score: evaluation.communication_score ?? null,
    clinical_reasoning_score: evaluation.clinical_reasoning_score ?? evaluation.mdm_score ?? null,
    component_scores: {
      focused_information_gathering: score(communication, 'focused_information_gathering'),
      closed_loop_team_communication: score(communication, 'closed_loop_team_communication'),
      efficiency_deduction: score(communication, 'efficiency_deduction'),
      orders_monitoring_quality: score(reasoning, 'orders_monitoring_quality'),
      clinical_reasoning_documentation: score(reasoning, 'clinical_reasoning_documentation'),
      safety_deduction: score(reasoning, 'safety_deduction'),
    },
    domain_scores: {
      communication: evaluation.communication_score ?? null,
      clinical_reasoning: evaluation.clinical_reasoning_score ?? evaluation.mdm_score ?? null,
    },
    communication_breakdown: redactStudyValue(evaluation.communication_breakdown ?? null, (result.redaction_terms as string[] | undefined) ?? []),
    clinical_reasoning_breakdown: redactStudyValue(evaluation.clinical_reasoning_breakdown ?? evaluation.mdm_breakdown ?? null, (result.redaction_terms as string[] | undefined) ?? []),
    evidence_event_ids: result.evidence_event_ids ?? [],
    generated_at: result.generated_at ?? null,
    prompt_version: result.prompt_version ?? null,
    model: result.model ?? null,
    error: redactStudyValue(result.error ?? null, (result.redaction_terms as string[] | undefined) ?? []),
  };
};

// Export callers pass the already-flattened reviewer shape returned by
// deidentifyStudyResult. Keeping this boundary explicit prevents a second
// canonicalization/deidentification pass from dropping narrative or scores.
export const studySheetRow = (result: Record<string, unknown>) => {
  const components = (result.component_scores ?? {}) as Record<string, unknown>;
  const flatten = (value: unknown) => JSON.stringify(value ?? null);
  return [
    result.batch_ordinal,
    result.specialty,
    result.case_label,
    result.packet_label,
    result.status,
    result.communication_score,
    result.clinical_reasoning_score,
    flatten(result.strengths),
    flatten(result.improvements),
    flatten(result.recommendations),
    flatten(result.evidence_event_ids),
    result.generated_at,
    result.prompt_version,
    result.model,
    flatten(result.error),
    components.focused_information_gathering,
    components.closed_loop_team_communication,
    components.efficiency_deduction,
    components.orders_monitoring_quality,
    components.clinical_reasoning_documentation,
    components.safety_deduction,
    flatten(result.communication_breakdown),
    flatten(result.clinical_reasoning_breakdown),
  ];
};

export const csvEscape = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const STUDY_SHEET_COLUMNS = ['batch_ordinal', 'specialty', 'case_label', 'packet_label', 'status', 'communication_score', 'clinical_reasoning_score', 'strengths_json', 'improvements_json', 'recommendations_json', 'evidence_event_ids_json', 'generated_at', 'prompt_version', 'model', 'error_json', 'focused_information_gathering_score', 'closed_loop_team_communication_score', 'efficiency_deduction_score', 'orders_monitoring_quality_score', 'clinical_reasoning_documentation_score', 'safety_deduction_score', 'communication_breakdown_json', 'clinical_reasoning_breakdown_json'];
