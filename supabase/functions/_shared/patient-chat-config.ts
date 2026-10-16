export type PatientResponseMode = 'responsive' | 'unable';
export type PatientSpeaker = 'patient' | 'caregiver';

// The structured contract is read-only compatibility for pinned attempts. It
// deliberately does not rewrite rooms or re-pin assignments.
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
  try { return record(JSON.parse(value)); } catch { return {}; }
};

const normalizeResponseMode = (...values: unknown[]): PatientResponseMode | undefined => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (normalized === 'unable' || normalized.includes('unable to respond') ||
      normalized.includes('unable to discuss') || normalized === 'noncommunicative' ||
      normalized === 'unresponsive') return 'unable';
    if (normalized === 'responsive') return 'responsive';
  }
  return undefined;
};

const hasLegacyUnableDeclaration = (...values: unknown[]) => values.some((value) => {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return normalized.includes('unable to respond') || normalized.includes('unable to discuss') ||
    normalized.includes('noncommunicative') || normalized.includes('unresponsive');
});

export const resolvePatientChatConfig = (room: PatientChatRoomConfig | null): ResolvedPatientChatConfig => {
  const context = parseContext(room?.emr_context);
  const bedside = record(context.bedside);
  const patientChat = record(context.patientChat);
  const rawVersion = patientChat.configVersion ?? bedside.patientChatConfigVersion ?? context.patientChatConfigVersion;
  const version = typeof rawVersion === 'number' ? rawVersion : Number(rawVersion);
  const legacy = !Number.isFinite(version) || version < PATIENT_CHAT_CONFIG_VERSION;
  const explicitMode = normalizeResponseMode(room?.patient_response_mode, patientChat.responseMode, bedside.patientResponseMode);
  const dedicatedPrompt = typeof room?.patient_conversation_prompt === 'string' ? room.patient_conversation_prompt.trim() : '';
  const legacyPrompt = String(patientChat.prompt ?? bedside.patientChatPrompt ?? '').trim();
  const prompt = dedicatedPrompt || legacyPrompt;
  const responseMode = explicitMode ?? (legacy && hasLegacyUnableDeclaration(
    patientChat.legacyResponseMode, bedside.legacyResponseMode, patientChat.disableReason,
    bedside.disableReason, room?.patient_participation_reason, dedicatedPrompt, legacyPrompt,
  ) ? 'unable' : 'responsive');
  const speaker: PatientSpeaker = room?.patient_speaker_type === 'caregiver' || patientChat.speaker === 'caregiver' || bedside.patientSpeakerType === 'caregiver'
    ? 'caregiver' : 'patient';
  const explicitEnabled = room?.patient_conversation_enabled ?? patientChat.enabled ?? bedside.patientChatEnabled;
  const enabled = Boolean(explicitEnabled) && Boolean(prompt);
  const reason = room?.patient_participation_reason?.trim() || String(patientChat.disableReason ?? bedside.disableReason ?? 'Patient cannot participate in conversation.');
  return { enabled, prompt, speaker, responseMode, reason };
};
