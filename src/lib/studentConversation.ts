export type StudentConversationMessage = {
  role: 'student' | 'patient' | 'consultant';
  content: string;
};

export type AuthoredPatientConversation = {
  enabled: boolean;
  prompt: string | null;
  reason: string | null;
  speaker: 'patient' | 'caregiver';
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const asString = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

export const parseAuthoredPatientConversation = (
  emrContext: unknown,
  fields: {
    enabled?: unknown;
    prompt?: unknown;
    reason?: unknown;
    speaker?: unknown;
  } = {},
): AuthoredPatientConversation => {
  let parsed = emrContext;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  const root = asRecord(parsed);
  const legacyPatient = asRecord(root?.patientChat);
  const legacyBedside = asRecord(asRecord(root?.package)?.bedside) ?? asRecord(root?.bedside);
  const prompt = asString(fields.prompt) ?? asString(legacyPatient?.prompt) ?? asString(legacyBedside?.patientChatPrompt);
  const reason = asString(fields.reason) ?? asString(legacyPatient?.disableReason) ?? asString(legacyBedside?.disableReason);
  const enabledValue = fields.enabled ?? legacyPatient?.enabled ?? legacyBedside?.patientChatEnabled;
  const speakerValue = fields.speaker ?? legacyPatient?.speaker ?? legacyBedside?.patientSpeakerType;
  return {
    enabled: Boolean(enabledValue) && Boolean(prompt),
    prompt,
    reason,
    speaker: speakerValue === 'caregiver' ? 'caregiver' : 'patient',
  };
};

export const mapStudentConversationMessages = (rows: Array<{ role?: string | null; content?: string | null }>): StudentConversationMessage[] =>
  rows
    .filter((row) => typeof row.content === 'string' && row.content.trim())
    .map((row) => ({
      role: row.role === 'consultant' ? 'consultant' : row.role === 'student' || row.role === 'user' ? 'student' : 'patient',
      content: row.content!.trim(),
    }));
