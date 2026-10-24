export const FACULTY_STUDY_PROTOCOL_VERSION = 'faculty-study-v1';
export type FacultyStudyDeploymentMode = 'study-enabled' | 'preflight-only';
export const studyActionAllowed = (action: string, mode: FacultyStudyDeploymentMode) => mode !== 'preflight-only' || action === 'preflight' || action === 'audit' || action === 'history' || action === 'evaluation_history' || action === 'download_evaluation' || action === 'export' || action === 'export_room_pdfs';

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
  evaluator_spec_version?: string;
  evaluator_spec_hash?: string;
  component_anchors?: Record<string, unknown>;
  attempts: StudyManifestItem[];
  target_ordinals?: number[];
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
export const studyProgress = (rows: Array<{ batch_ordinal: number; result?: unknown; error?: unknown }>, scopedOrdinals: Set<number>) => {
  const scopedRows = rows.filter((row) => scopedOrdinals.has(row.batch_ordinal));
  const completedCount = scopedRows.filter((row) => Boolean(row.result) && !row.error).length;
  const errorCount = scopedRows.filter((row) => Boolean(row.error)).length;
  const totalCount = scopedOrdinals.size;
  return { completedCount, errorCount, totalCount, pendingCount: totalCount - completedCount - errorCount };
};
export const resolveStudyTargetOrdinals = (persisted: number[] | undefined, requested: unknown) => {
  const source = requested === undefined || requested === null ? persisted : requested;
  if (source === undefined) return null;
  if (!Array.isArray(source) || source.length === 0 || source.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 30) || new Set(source).size !== source.length) throw new Error('STUDY_TARGET_ORDINALS_INVALID');
  if (persisted && requested !== undefined && requested !== null && source.some((ordinal) => !persisted.includes(ordinal))) throw new Error('STUDY_TARGET_ORDINALS_OUTSIDE_SCOPE');
  return [...source] as number[];
};
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
  const targetOrdinals = source.target_ordinals === undefined ? undefined : source.target_ordinals;
  if (targetOrdinals !== undefined && (!Array.isArray(targetOrdinals) || targetOrdinals.length === 0 || targetOrdinals.some((ordinal) => !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 30) || new Set(targetOrdinals).size !== targetOrdinals.length)) {
    throw new Error('STUDY_MANIFEST_INVALID: target_ordinals must contain unique ordinals from 1 through 30');
  }
  const evaluatorSpecVersion = text('evaluator_spec_version');
  const evaluatorSpecHash = text('evaluator_spec_hash');
  const componentAnchors = source.component_anchors && typeof source.component_anchors === 'object' && !Array.isArray(source.component_anchors)
    ? source.component_anchors as Record<string, unknown> : undefined;
  return { batch_key: batchKey, prompt_version: promptVersion, prompt_text: promptText, expected_model: expectedModel, ...(evaluatorSpecVersion ? { evaluator_spec_version: evaluatorSpecVersion } : {}), ...(evaluatorSpecHash ? { evaluator_spec_hash: evaluatorSpecHash } : {}), ...(componentAnchors ? { component_anchors: componentAnchors } : {}), attempts, ...(targetOrdinals ? { target_ordinals: [...targetOrdinals] } : {}) };
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
  const flat = !result.evaluation && ('component_scores' in result || 'communication_score' in result || result.status === 'error');
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
      case_goals: result.case_goals ?? [],
      safety_result: result.safety_result ?? null,
      critical_safety_action: result.critical_safety_action ?? null,
      evidence_validation_warnings: redactStudyValue(result.evidence_validation_warnings ?? [], privateTerms),
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
    case_goals: result.case_goals ?? [],
    safety_result: result.safety_result ?? evaluation.safety_result ?? null,
    critical_safety_action: result.critical_safety_action ?? null,
    evidence_validation_warnings: redactStudyValue(evaluation.evidence_validation_warnings ?? result.evidence_validation_warnings ?? [], (result.redaction_terms as string[] | undefined) ?? []),
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
    flatten(result.evidence_validation_warnings),
  ];
};

export const csvEscape = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const htmlEscape = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const sheetText = (value: unknown) => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);

const htmlNarrative = (title: string, value: unknown) => {
  const text = value == null ? 'Not recorded' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return `<section><h2>${htmlEscape(title)}</h2><pre>${htmlEscape(sheetText(text))}</pre></section>`;
};

export const buildEvaluationSheetHtml = (result: Record<string, unknown>) => {
  const components = (result.component_scores ?? {}) as Record<string, unknown>;
  const domains = (result.domain_scores ?? {}) as Record<string, unknown>;
  const componentRows = [
    ['Focused information gathering', components.focused_information_gathering],
    ['Closed-loop team communication', components.closed_loop_team_communication],
    ['Efficiency deduction', components.efficiency_deduction],
    ['Orders and monitoring quality', components.orders_monitoring_quality],
    ['Clinical reasoning documentation', components.clinical_reasoning_documentation],
    ['Safety deduction', components.safety_deduction],
  ].map(([label, score]) => {
    const component = score && typeof score === 'object' ? score as Record<string, unknown> : {};
    return `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(component.score)}</td><td>${htmlEscape(sheetText(component.feedback ?? component.narrative ?? 'Not recorded'))}</td></tr>`;
  }).join('');
  const domainRows = [
    ['Communication domain', domains.communication],
    ['Clinical reasoning domain', domains.clinical_reasoning],
  ].map(([label, score]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(score)}</td></tr>`).join('');
  const goals = Array.isArray(result.case_goals) ? result.case_goals : [];
  const safety = result.safety_result && typeof result.safety_result === 'object' ? result.safety_result as Record<string, unknown> : null;
  const safetyAction = safety?.action ?? result.critical_safety_action ?? 'Not observed';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Faculty evaluation ${htmlEscape(result.batch_ordinal)}</title><style>@page{size:Letter;margin:.35in}body{font:10px system-ui,sans-serif;max-width:900px;margin:10px auto;color:#172033}h1{font-size:18px;margin:0 0 2px}h2{font-size:11px;border-bottom:1px solid #cbd5e1;padding-bottom:2px;margin:8px 0 3px}p{margin:2px 0}ul{margin:2px 0;padding-left:16px}table{border-collapse:collapse;width:100%;margin-top:4px}th,td{border:1px solid #cbd5e1;padding:3px;text-align:left}th{width:30%;background:#f8fafc}pre{white-space:pre-wrap;font:inherit;line-height:1.1;margin:2px 0}header p{color:#475569}.sheet-section{break-inside:avoid}.safety{border:2px solid #b45309;padding:5px}.page-proof{break-before:avoid}@media print{body{margin:0}button{display:none}}</style></head><body><header><h1>NEW-FORMAT Faculty Evaluation</h1><p><strong>${htmlEscape(result.specialty)} · ${htmlEscape(result.case_label)} · ${htmlEscape(result.packet_label)}</strong></p><p>Status: ${htmlEscape(result.status)} · Prompt: ${htmlEscape(result.prompt_version)} · Generated: ${htmlEscape(result.generated_at)} · Model: ${htmlEscape(result.model)}</p></header><section class="sheet-section"><h2>Case goals</h2>${goals.length ? `<ul>${goals.map((goal) => `<li>${htmlEscape(goal)}</li>`).join('')}</ul>` : '<p>Not recorded</p>'}</section><section class="sheet-section safety"><h2>Separate critical safety action</h2><p>${htmlEscape(safetyAction)}</p><p>Safety result: ${htmlEscape(safety?.level ?? 'none')}</p></section><section class="sheet-section"><h2>Scores</h2><table><thead><tr><th>Component</th><th>Score</th><th>Feedback</th></tr></thead><tbody>${componentRows}${domainRows}</tbody></table></section>${htmlNarrative('Strengths', result.strengths)}${htmlNarrative('Improvements', result.improvements)}${htmlNarrative('Recommendations', result.recommendations)}${htmlNarrative('Communication breakdown', result.communication_breakdown)}${htmlNarrative('Clinical reasoning breakdown', result.clinical_reasoning_breakdown)}${htmlNarrative('Evidence event IDs', result.evidence_event_ids)}${htmlNarrative('Evidence validation warnings', result.evidence_validation_warnings)}</body></html>`;
};

/** Validate the actual PDF bytes produced by the synthetic renderer. */
export const countRenderedPdfPages = (pdf: Uint8Array): number => {
  const text = new TextDecoder('latin1').decode(pdf);
  if (!text.startsWith('%PDF-')) throw new Error('RENDERED_SHEET_PDF_INVALID');
  const pageObjects = text.match(/\/Type\s*\/Page(?:\s|\/|>)/g) ?? [];
  if (pageObjects.length === 0) throw new Error('RENDERED_SHEET_PDF_NO_PAGES');
  return pageObjects.length;
};

export const proveRenderedSheetStructure = (html: string, renderedPdf?: Uint8Array) => {
  const required = ['Case goals', 'Separate critical safety action', 'Focused information gathering', 'Closed-loop team communication', 'Efficiency deduction', 'Orders and monitoring quality', 'Clinical reasoning documentation', 'Safety deduction', 'Communication domain', 'Clinical reasoning domain', 'Communication breakdown', 'Clinical reasoning breakdown', 'Evidence event IDs', 'Evidence validation warnings'];
  const missing = required.filter((text) => !html.includes(text));
  const pageCount = renderedPdf ? countRenderedPdfPages(renderedPdf) : null;
  return { valid: missing.length === 0 && (html.match(/<html>/g) ?? []).length === 1 && (html.match(/@page/g) ?? []).length === 1 && pageCount === 1, missing, ...(pageCount === null ? {} : { page_count: pageCount }) };
};

export const STUDY_SHEET_COLUMNS = ['batch_ordinal', 'specialty', 'case_label', 'packet_label', 'status', 'communication_score', 'clinical_reasoning_score', 'strengths_json', 'improvements_json', 'recommendations_json', 'evidence_event_ids_json', 'generated_at', 'prompt_version', 'model', 'error_json', 'focused_information_gathering_score', 'closed_loop_team_communication_score', 'efficiency_deduction_score', 'orders_monitoring_quality_score', 'clinical_reasoning_documentation_score', 'safety_deduction_score', 'communication_breakdown_json', 'clinical_reasoning_breakdown_json', 'evidence_validation_warnings_json'];
