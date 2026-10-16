export type ConversationPromptKind = 'patient' | 'consultant';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const parse = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string') return record(value);
  try { return record(JSON.parse(value)); } catch { return {}; }
};

/** Resolve the pinned authored field only. No clinical/default text is added. */
export function resolvePinnedConversationPrompt(
  room: Record<string, unknown> | null | undefined,
  baseline: unknown,
  kind: ConversationPromptKind,
): string {
  const pinned = { ...record(room), ...record(baseline) };
  const directKey = kind === 'patient' ? 'patient_conversation_prompt' : 'consultant_response_prompt';
  const direct = typeof pinned[directKey] === 'string' ? pinned[directKey].trim() : '';
  if (direct) return direct;

  const context = parse(pinned.emr_context);
  const patientChat = record(context.patientChat);
  const packageBedside = record(record(context.package).bedside);
  const nestedKey = kind === 'patient' ? 'prompt' : 'consultantResponsePrompt';
  const nested = kind === 'patient' ? patientChat[nestedKey] : packageBedside[nestedKey];
  return typeof nested === 'string' ? nested.trim() : '';
}
