export type JsonObject = Record<string, unknown>;

export const parseRoomEmrContext = (value: unknown): JsonObject => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as JsonObject) };
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as JsonObject) } : {};
  } catch {
    return { context: value };
  }
};

export const roomEmrContextText = (value: unknown): string => {
  if (typeof value !== 'string') {
    const parsed = parseRoomEmrContext(value);
    return typeof parsed.context === 'string' ? parsed.context : '';
  }
  const parsed = parseRoomEmrContext(value);
  if (typeof parsed.context === 'string') return parsed.context;
  return value.trim().startsWith('{') || value.trim().startsWith('[') ? '' : value;
};

/** Preserve every authored nested EMR key and replace only its context text. */
export const buildContextOnlyEmrPayload = (existing: unknown, contextText: string): string => {
  const next = { ...parseRoomEmrContext(existing) };
  if (contextText.trim()) next.context = contextText.trim();
  else delete next.context;
  return JSON.stringify(next);
};

const stableJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as JsonObject).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableJson(child)]));
  }
  return value;
};

export const structurallyEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));

export type RoomEditorNonContextSnapshot = JsonObject;

export const buildContextOnlyRoomUpdate = (
  existing: unknown,
  contextText: string,
  current: RoomEditorNonContextSnapshot,
  original: RoomEditorNonContextSnapshot,
): { emr_context: string } | null => {
  if (!contextText.trim() && !roomEmrContextText(existing).trim()) return null;
  if (contextText.trim() === roomEmrContextText(existing).trim()) return null;
  if (!structurallyEqual(current, original)) return null;
  return { emr_context: buildContextOnlyEmrPayload(existing, contextText) };
};
