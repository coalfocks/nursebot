export type PatientChatContext = Record<string, unknown>;

export const mergePatientChatContext = (
  existing: PatientChatContext | null | undefined,
  responseMode: 'responsive' | 'unable',
): PatientChatContext => {
  const current = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const patientChat = current.patientChat && typeof current.patientChat === 'object' && !Array.isArray(current.patientChat)
    ? current.patientChat as PatientChatContext
    : {};
  return {
    ...current,
    patientChat: { ...patientChat, responseMode },
  };
};

export const normalizePatientResponseMode = (value: unknown): 'responsive' | 'unable' => {
  if (typeof value !== 'string') return 'responsive';
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return normalized === 'unable' || normalized.includes('unable to respond') || normalized.includes('unable to discuss') || normalized === 'noncommunicative' || normalized === 'unresponsive'
    ? 'unable'
    : 'responsive';
};
