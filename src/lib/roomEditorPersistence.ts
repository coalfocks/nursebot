export type JsonObject = Record<string, unknown>;

export const parseJsonObject = (value: unknown): JsonObject => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as JsonObject) };
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as JsonObject) } : {};
  } catch {
    return {};
  }
};

/** Preserve the authored JSON-shaped EMR context and replace only its context text. */
export const buildContextOnlyEmrPayload = (existing: unknown, contextText: string): string =>
  JSON.stringify({ ...parseJsonObject(existing), context: contextText.trim() });
