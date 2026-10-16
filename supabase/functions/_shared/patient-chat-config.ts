export type PatientResponseMode = 'responsive' | 'unable';
export type PatientSpeaker = 'patient' | 'caregiver';

// Version 2 is the structured patientChat contract. Older pinned assignments
// may have only a prompt and an inline legacy participation declaration.
// Compatibility is read-only: it never rewrites rooms or re-pins attempts.
export const PATIENT_CHAT_CONFIG_VERSION = 2;

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

const normalizeResponseMode = (...values: unknown[]): PatientResponseMode | undefined => {
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
  return undefined;
};

const hasLegacyUnableDeclaration = (...values: unknown[]): boolean => values.some((value) => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return normalized.includes('unable to respond') ||
    normalized.includes('unable to discuss') ||
    normalized.includes('noncommunicative') ||
    normalized.includes('unresponsive');
});

export const resolvePatientChatConfig = (room: PatientChatRoomConfig | null): ResolvedPatientChatConfig => {
  const context = parseContext(room?.emr_context);
  const bedside = record(context.bedside);
  const patientChat = record(context.patientChat);
  const rawConfigVersion = patientChat.configVersion ?? bedside.patientChatConfigVersion ?? context.patientChatConfigVersion;
  const configVersion = typeof rawConfigVersion === 'number' ? rawConfigVersion : Number(rawConfigVersion);
  const isLegacyConfig = !Number.isFinite(configVersion) || configVersion < PATIENT_CHAT_CONFIG_VERSION;

  // Explicit structured mode is authoritative regardless of where the prompt came from.
  const explicitResponseMode = normalizeResponseMode(
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
  // Pre-v2 pinned configs sometimes encoded noncommunicative behavior only in
  // the authored prompt/reason. Interpret that declaration only when no
  // explicit mode exists; never override an explicit responsive setting.
  const responseMode = explicitResponseMode ?? (isLegacyConfig &&
    hasLegacyUnableDeclaration(
      patientChat.legacyResponseMode,
      bedside.legacyResponseMode,
      patientChat.disableReason,
      bedside.disableReason,
      room?.patient_participation_reason,
      dedicatedPrompt,
      legacyPrompt,
    ) ? 'unable' : 'responsive'
  );
  const explicitEnabled = room?.patient_conversation_enabled ?? patientChat.enabled ?? bedside.patientChatEnabled;
  const enabled = Boolean(explicitEnabled) && Boolean(prompt);
  const reason = room?.patient_participation_reason?.trim() ||
    String(patientChat.disableReason ?? bedside.disableReason ??
      (prompt ? 'Patient conversation is disabled for this room.' : 'Patient Conversation Prompt not configured. Ask an administrator to configure this room.'));

  return { enabled, prompt, speaker, responseMode, reason };
};
