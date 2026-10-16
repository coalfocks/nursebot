export type PatientResponseMode = 'responsive' | 'unable';

export const normalizePatientResponseMode = (value: unknown): PatientResponseMode => {
  if (typeof value !== 'string') return 'responsive';
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return normalized === 'unable' || normalized.includes('unable to respond') || normalized.includes('unable to discuss') || normalized === 'noncommunicative' || normalized === 'unresponsive'
    ? 'unable'
    : 'responsive';
};

export const mergePatientChatContext = (context: Record<string, unknown>, responseMode: PatientResponseMode) => {
  const existing = context.patientChat && typeof context.patientChat === 'object' && !Array.isArray(context.patientChat)
    ? context.patientChat as Record<string, unknown>
    : {};
  return { ...context, patientChat: { ...existing, responseMode } };
};
