export type AssignmentDiagnosticPhase =
  | 'publication per room'
  | 'readiness'
  | 'existing-row reconciliation'
  | 'materialization per assignment';

export type AssignmentDiagnosticClassification = 'response-loss/unknown-commit' | 'confirmed pre-write';

export type AssignmentDiagnostic = {
  phase: AssignmentDiagnosticPhase;
  boundary: string;
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
  status: number | null;
  classification: AssignmentDiagnosticClassification;
};

type SupabaseLikeError = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

const textField = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;
const statusField = (error: SupabaseLikeError): number | null => {
  const value = error.status ?? error.statusCode;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const knownPreWriteMarker = (value: string | null): boolean => Boolean(
  value && (
    value.includes('MAR_') && (
      value.includes('INVALID') ||
      value.includes('REQUIRED') ||
      value.includes('NOT_FOUND') ||
      value.includes('NOT_READY') ||
      value.includes('SCHOOL') ||
      value.includes('ROLE') ||
      value.includes('AUTH') ||
      value.includes('MISMATCH') ||
      value.includes('PUBLISHED')
    )
  )
);

export const normalizeAssignmentDiagnostic = (
  error: unknown,
  phase: AssignmentDiagnosticPhase,
  boundary: string,
  kind: 'read' | 'write' = 'read',
): AssignmentDiagnostic => {
  const candidate: SupabaseLikeError = error !== null && typeof error === 'object'
    ? error as SupabaseLikeError
    : {};
  const code = textField(candidate.code);
  const message = textField(candidate.message) ?? (error instanceof Error ? error.message : String(error ?? 'Unknown error'));
  const details = textField(candidate.details);
  const hint = textField(candidate.hint);
  const confirmedPreWrite = kind === 'read' || [code, message, details, hint].some(knownPreWriteMarker);

  return {
    phase,
    boundary,
    code,
    message,
    details,
    hint,
    status: statusField(candidate),
    classification: confirmedPreWrite ? 'confirmed pre-write' : 'response-loss/unknown-commit',
  };
};

export const assignmentDiagnosticError = (
  error: unknown,
  phase: AssignmentDiagnosticPhase,
  boundary: string,
  kind: 'read' | 'write' = 'read',
): AssignmentDiagnostic & Error => {
  const diagnostic = normalizeAssignmentDiagnostic(error, phase, boundary, kind);
  const wrapped = new Error(diagnostic.message) as AssignmentDiagnostic & Error;
  Object.assign(wrapped, diagnostic);
  return wrapped;
};
