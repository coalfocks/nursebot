export type PatientResponseMode = 'responsive' | 'unable';
export type PatientSpeaker = 'patient' | 'caregiver';

export type PatientChatRoomConfig = {
  emr_context?: unknown;
  patient_conversation_prompt?: string | null;
  patient_conversation_enabled?: boolean | null;
  patient_participation_reason?: string | null;
  patient_speaker_type?: PatientSpeaker | null;
  patient_response_mode?: string | null;
};

export type ResolvedPatientChatConfig = {
  enabled: boolean;
  prompt: string;
  speaker: PatientSpeaker;
  responseMode: PatientResponseMode;
  reason: string;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const parseContext = (value: unknown) => {
  if (typeof value !== 'string') return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
};

const normalizeResponseMode = (...values: unknown[]): PatientResponseMode => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (
      normalized === 'unable' ||
      normalized.includes('unable to respond') ||
      normalized.includes('unable to discuss') ||
      normalized === 'noncommunicative' ||
      normalized === 'unresponsive'
    ) return 'unable';
    if (normalized === 'responsive') return 'responsive';
  }
  return 'responsive';
};

export const resolvePatientChatConfig = (room: PatientChatRoomConfig | null): ResolvedPatientChatConfig => {
  const context = parseContext(room?.emr_context);
  const bedside = record(context.bedside);
  const patientChat = record(context.patientChat);

  // Explicit structured mode is authoritative regardless of where the prompt came from.
  const responseMode = normalizeResponseMode(
    room?.patient_response_mode,
    patientChat.responseMode,
    bedside.patientResponseMode,
  );
  const speaker: PatientSpeaker =
    room?.patient_speaker_type === 'caregiver' || patientChat.speaker === 'caregiver' || bedside.patientSpeakerType === 'caregiver'
      ? 'caregiver'
      : 'patient';

  const dedicatedPrompt = typeof room?.patient_conversation_prompt === 'string'
    ? room.patient_conversation_prompt.trim()
    : '';
  const legacyPrompt = String(patientChat.prompt ?? bedside.patientChatPrompt ?? '').trim();
  const prompt = dedicatedPrompt || legacyPrompt;
  const explicitEnabled = room?.patient_conversation_enabled ?? patientChat.enabled ?? bedside.patientChatEnabled;
  const enabled = Boolean(explicitEnabled) && Boolean(prompt);
  const reason = room?.patient_participation_reason?.trim() ||
    String(patientChat.disableReason ?? bedside.disableReason ?? 'Patient cannot participate in conversation.');

  return { enabled, prompt, speaker, responseMode, reason };
};
