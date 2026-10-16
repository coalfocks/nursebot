export type JsonObject = Record<string, unknown>;

/** Accept both the legacy text column and the JSON-shaped Room00 payload. */
export function parseRoomEmrContext(raw: unknown): JsonObject {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...(raw as JsonObject) };
  if (typeof raw !== 'string') return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...(parsed as JsonObject) };
  } catch {
    // Legacy EHR context was plain text; preserve it under the canonical key.
  }
  return { context: raw };
}

export function roomEmrContextText(raw: unknown): string {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const parsed = parseRoomEmrContext(raw);
    if (typeof parsed.context === 'string') return parsed.context;
    // A JSON-shaped payload with no context key has no editable context text;
    // returning the serialized object here would make every edit look dirty.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return '';
    return raw;
  }
  const parsed = parseRoomEmrContext(raw);
  return typeof parsed.context === 'string' ? parsed.context : '';
}

export function buildContextOnlyEmrPayload(raw: unknown, contextText: string): string {
  const payload = parseRoomEmrContext(raw);
  const next = { ...payload };
  if (contextText.trim()) next.context = contextText.trim();
  else delete next.context;
  return JSON.stringify(next);
}

/** Stable structural comparison; JSON property insertion order is irrelevant. */
export function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableJson(child)]),
    );
  }
  return value;
}

export function structurallyEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

export type RoomEditorNonContextSnapshot = Record<string, unknown>;

export function isContextOnlyEdit(
  current: RoomEditorNonContextSnapshot,
  original: RoomEditorNonContextSnapshot,
  contextChanged: boolean,
): boolean {
  return contextChanged && structurallyEqual(current, original);
}

export function buildContextOnlyRoomUpdate(
  raw: unknown,
  contextText: string,
  current: RoomEditorNonContextSnapshot,
  original: RoomEditorNonContextSnapshot,
): { emr_context: string } | null {
  if (!isContextOnlyEdit(current, original, contextText.trim() !== roomEmrContextText(raw).trim())) return null;
  return { emr_context: buildContextOnlyEmrPayload(raw, contextText) };
}
