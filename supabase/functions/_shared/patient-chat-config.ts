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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const parseContext = (value: unknown) => {
  if (typeof value !== 'string') return asRecord(value);
  try { return asRecord(JSON.parse(value)); } catch { return {}; }
};

export const normalizePatientResponseMode = (...values: unknown[]): PatientResponseMode => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (normalized === 'unable' || normalized === 'unable to respond' || normalized === 'unable to discuss' || normalized === 'noncommunicative' || normalized === 'unresponsive') return 'unable';
    if (normalized === 'responsive') return 'responsive';
  }
  return 'responsive';
};

const authoredStatusMode = (prompt: string): PatientResponseMode | null => {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim().replace(/[ \t]+/g, ' ') ?? '';
  const marker = firstLine.match(/^INTERVIEW_STATUS:\s*(responsive|unavailable)\s*$/i);
  if (!marker) return null;
  return marker[1].toLowerCase() === 'unavailable' ? 'unable' : 'responsive';
};

const exactLegacyUnableDeclaration = (prompt: string): boolean => {
  const normalized = prompt.trim().toLowerCase().replace(/[ \t\r\n]+/g, ' ');
  return ['patient unable to respond', 'patient unable to respond.', 'patient unable to discuss', 'noncommunicative', 'unresponsive'].includes(normalized);
};

export const resolvePatientChatConfig = (room: PatientChatRoomConfig | null): ResolvedPatientChatConfig => {
  const context = parseContext(room?.emr_context);
  const bedside = asRecord(context.bedside);
  const patientChat = asRecord(context.patientChat);
  const speaker: PatientSpeaker = room?.patient_speaker_type === 'caregiver' || patientChat.speaker === 'caregiver' || bedside.patientSpeakerType === 'caregiver' ? 'caregiver' : 'patient';
  const dedicatedPrompt = typeof room?.patient_conversation_prompt === 'string' ? room.patient_conversation_prompt.trim() : '';
  const legacyPrompt = String(patientChat.prompt ?? bedside.patientChatPrompt ?? '').trim();
  const prompt = dedicatedPrompt || legacyPrompt;
  const promptMode = authoredStatusMode(prompt);
  const responseMode = promptMode ?? normalizePatientResponseMode(room?.patient_response_mode, patientChat.responseMode, bedside.patientResponseMode);
  const resolvedResponseMode = promptMode ?? (exactLegacyUnableDeclaration(prompt) ? 'unable' : responseMode);
  const explicitEnabled = room?.patient_conversation_enabled ?? patientChat.enabled ?? bedside.patientChatEnabled;
  const enabled = Boolean(explicitEnabled) && Boolean(prompt);
  const reason = room?.patient_participation_reason?.trim() || String(patientChat.disableReason ?? bedside.disableReason ?? 'Patient cannot participate in conversation.');
  return { enabled, prompt, speaker, responseMode: resolvedResponseMode, reason };
};
