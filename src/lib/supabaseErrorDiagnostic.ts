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

const isResponseLike = (value: unknown): value is Response => Boolean(
  value &&
  typeof value === 'object' &&
  typeof (value as { clone?: unknown }).clone === 'function' &&
  typeof (value as { json?: unknown }).json === 'function',
);

const responseFrom = (error: unknown): Response | null => {
  if (!error || typeof error !== 'object') return null;
  const source = error as { context?: unknown; response?: unknown };
  if (isResponseLike(source.context)) return source.context;
  if (isResponseLike(source.response)) return source.response;
  return null;
};

const structuredBody = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const root = body as Record<string, unknown>;
  const nested = root.error && typeof root.error === 'object' && !Array.isArray(root.error)
    ? root.error as Record<string, unknown>
    : {};
  return {
    status: root.status ?? nested.status,
    code: root.code ?? nested.code,
    message: root.message ?? (typeof root.error === 'string' ? root.error : nested.message),
    details: root.details ?? nested.details,
    hint: root.hint ?? nested.hint,
  };
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

export const readSupabaseErrorDiagnostic = async (error: unknown): Promise<SupabaseErrorDiagnostic> => {
  const response = responseFrom(error);
  if (!response) return describeSupabaseError(error);

  let body: Record<string, unknown> = {};
  try {
    body = structuredBody(await response.clone().json());
  } catch {
    // Preserve the original error and return the transport fields when the body is not JSON.
  }

  const base = describeSupabaseError(error);
  return describeSupabaseError({
    status: body.status ?? base.status,
    code: body.code ?? base.code,
    message: body.message ?? base.message,
    details: body.details ?? base.details,
    hint: body.hint ?? base.hint,
  });
};
