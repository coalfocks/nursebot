export type ConversationPromptKind = 'patient' | 'consultant';

export type AuthoredConversationPrompts = {
  patient_conversation_prompt: string | null;
  consultant_response_prompt: string | null;
};

/** The authored room field is the complete channel instruction. Do not add defaults here. */
export function normalizeAuthoredConversationPrompt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const prompt = value.trim();
  return prompt || null;
}

export function buildConversationPromptPatch(
  kind: ConversationPromptKind,
  value: unknown,
): Partial<AuthoredConversationPrompts> {
  return kind === 'patient'
    ? { patient_conversation_prompt: normalizeAuthoredConversationPrompt(value) }
    : { consultant_response_prompt: normalizeAuthoredConversationPrompt(value) };
}

export function resolveAuthoredConversationPrompt(
  room: Partial<AuthoredConversationPrompts> | null | undefined,
  kind: ConversationPromptKind,
): string {
  const value = kind === 'patient' ? room?.patient_conversation_prompt : room?.consultant_response_prompt;
  return typeof value === 'string' ? value.trim() : '';
}
