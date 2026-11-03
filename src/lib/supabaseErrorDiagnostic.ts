const MAX_FIELD_LENGTH = 400;

export interface SupabaseErrorDiagnostic {
  status: number | null;
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
  description: string;
}

const bounded = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_FIELD_LENGTH);
};

const numericStatus = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) return value;
  return null;
};

const readContext = (error: unknown): Record<string, unknown> => {
  if (!error || typeof error !== 'object') return {};
  const context = (error as { context?: unknown }).context;
  return context && typeof context === 'object' ? context as Record<string, unknown> : {};
};

export const describeSupabaseError = (error: unknown): SupabaseErrorDiagnostic => {
  const source = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const context = readContext(error);
  const response = context.response && typeof context.response === 'object'
    ? context.response as Record<string, unknown>
    : {};
  const status = numericStatus(source.status) ?? numericStatus(context.status) ?? numericStatus(response.status);
  const code = bounded(source.code) ?? bounded(context.code) ?? bounded(response.code);
  const message = bounded(source.message) ?? bounded(context.message) ?? bounded(response.message) ?? 'Unknown Supabase error';
  const details = bounded(source.details) ?? bounded(context.details) ?? bounded(response.details);
  const hint = bounded(source.hint) ?? bounded(context.hint) ?? bounded(response.hint);
  const fields = [
    status == null ? null : `status=${status}`,
    code ? `code=${code}` : null,
    `message=${message}`,
    details ? `details=${details}` : null,
    hint ? `hint=${hint}` : null,
  ].filter(Boolean);
  return { status, code, message, details, hint, description: fields.join('; ') };
};
