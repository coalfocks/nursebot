export const FACULTY_STUDY_PROTOCOL_VERSION = 'faculty-study-v1';

export type StudyManifestItem = {
  case_number: number;
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
  'evaluator_config_id',
  'evaluator_version',
] as const;

export const snapshotAssignmentProtection = (assignment: Record<string, unknown>) =>
  Object.fromEntries(STUDY_ASSIGNMENT_PROTECTED_FIELDS.map((field) => [field, assignment[field] ?? null]));

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
    const caseNumber = row.case_number;
    const assignmentId = typeof row.assignment_id === 'string' ? row.assignment_id.trim() : '';
    if (typeof caseNumber !== 'number' || !Number.isInteger(caseNumber) || caseNumber < 1 || caseNumber > 30) throw new Error(`STUDY_MANIFEST_INVALID: invalid case number at position ${index + 1}`);
    if (!UUID.test(assignmentId)) throw new Error(`STUDY_MANIFEST_INVALID: invalid assignment id at Case ${caseNumber}`);
    return { case_number: caseNumber, assignment_id: assignmentId };
  });
  const numbers = attempts.map((item) => item.case_number);
  if (new Set(numbers).size !== 30 || numbers.some((number, index) => number !== index + 1)) throw new Error('STUDY_MANIFEST_INVALID: case_number must contain 1 through 30 in order');
  if (new Set(attempts.map((item) => item.assignment_id)).size !== 30) throw new Error('STUDY_MANIFEST_INVALID: assignment ids must be unique');
  return { batch_key: batchKey, prompt_version: promptVersion, prompt_text: promptText, expected_model: expectedModel, attempts };
};

export const deidentifyStudyResult = (result: Record<string, unknown>) => {
  const evaluation = result.evaluation && typeof result.evaluation === 'object' ? result.evaluation as Record<string, unknown> : {};
  const communication = evaluation.communication_breakdown && typeof evaluation.communication_breakdown === 'object' ? evaluation.communication_breakdown as Record<string, unknown> : {};
  const reasoning = (evaluation.clinical_reasoning_breakdown ?? evaluation.mdm_breakdown) && typeof (evaluation.clinical_reasoning_breakdown ?? evaluation.mdm_breakdown) === 'object'
    ? (evaluation.clinical_reasoning_breakdown ?? evaluation.mdm_breakdown) as Record<string, unknown> : {};
  const score = (group: Record<string, unknown>, key: string) => {
    const component = group[key];
    return component && typeof component === 'object' ? (component as Record<string, unknown>).score ?? null : null;
  };
  return {
    case_number: result.case_number,
    status: result.status,
    strengths: evaluation.strengths ?? [],
    improvements: evaluation.improvements ?? [],
    recommendations: evaluation.recommendations ?? [],
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
    communication_breakdown: evaluation.communication_breakdown ?? null,
    clinical_reasoning_breakdown: evaluation.clinical_reasoning_breakdown ?? evaluation.mdm_breakdown ?? null,
    evidence_event_ids: result.evidence_event_ids ?? [],
    generated_at: result.generated_at ?? null,
    prompt_version: result.prompt_version ?? null,
    model: result.model ?? null,
    error: result.error ?? null,
  };
};

export const studySheetRow = (result: Record<string, unknown>) => {
  const safe = deidentifyStudyResult(result) as Record<string, unknown>;
  const components = safe.component_scores as Record<string, unknown>;
  const flatten = (value: unknown) => JSON.stringify(value ?? null);
  return [
    safe.case_number,
    safe.status,
    safe.communication_score,
    safe.clinical_reasoning_score,
    flatten(safe.strengths),
    flatten(safe.improvements),
    flatten(safe.recommendations),
    flatten(safe.evidence_event_ids),
    safe.generated_at,
    safe.prompt_version,
    safe.model,
    flatten(safe.error),
    components.focused_information_gathering,
    components.closed_loop_team_communication,
    components.efficiency_deduction,
    components.orders_monitoring_quality,
    components.clinical_reasoning_documentation,
    components.safety_deduction,
  ];
};

export const csvEscape = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const STUDY_SHEET_COLUMNS = ['case_number', 'status', 'communication_score', 'clinical_reasoning_score', 'strengths_json', 'improvements_json', 'recommendations_json', 'evidence_event_ids_json', 'generated_at', 'prompt_version', 'model', 'error_json', 'focused_information_gathering_score', 'closed_loop_team_communication_score', 'efficiency_deduction_score', 'orders_monitoring_quality_score', 'clinical_reasoning_documentation_score', 'safety_deduction_score'];
