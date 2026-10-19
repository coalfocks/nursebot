import { CONSULTANT_DIRECTORY } from './consultant-directory.ts';

// This contract is coordinated with the consultant_transport_contract migration
// and the consultant-chat Edge Function. The portal must remain unavailable if
// either side does not report this exact version.
export const CONSULTANT_TRANSPORT_SCHEMA_VERSION = 2;
export const CONSULTANT_TRANSPORT_FUNCTION_VERSION = 2;

export type ConsultantAudience = 'adult' | 'pediatric';

export type FrozenConsultantPayload = {
  assignmentId: string;
  audience: ConsultantAudience;
  specialty: string;
  message: string;
};

export type StoredConsultantPayload = FrozenConsultantPayload & {
  payload_hash?: string | null;
};

export type UntrustedConsultantInput = {
  assignmentId?: unknown;
  audience?: unknown;
  specialty?: unknown;
  message?: unknown;
  clientRequestId?: unknown;
};

export const validateConsultantTransportInput = (input: UntrustedConsultantInput) => {
  const specialty = typeof input.specialty === 'string' ? input.specialty.trim() : '';
  const message = typeof input.message === 'string' ? input.message : '';
  const clientRequestId = typeof input.clientRequestId === 'string' ? input.clientRequestId.trim() : '';
  if (!input.assignmentId || typeof input.assignmentId !== 'string' || !clientRequestId) return { ok: false as const, error: 'assignmentId, message, and clientRequestId are required' };
  if (!isConsultantAudience(input.audience)) return { ok: false as const, error: 'Consultant audience must be adult or pediatric' };
  const canonicalService = canonicalConsultantService(input.audience, specialty);
  if (!canonicalService) return { ok: false as const, error: 'Consultant service is not available in the selected audience directory' };
  if (!message.trim()) return { ok: false as const, error: 'Consultant message is required' };
  if (message.length > 1200) return { ok: false as const, error: 'Consultant messages must be 1,200 characters or fewer' };
  return {
    ok: true as const,
    clientRequestId,
    payload: { assignmentId: input.assignmentId, audience: input.audience, specialty: canonicalService, message } satisfies FrozenConsultantPayload,
  };
};

export const isConsultantAudience = (value: unknown): value is ConsultantAudience => value === 'adult' || value === 'pediatric';

export const canonicalConsultantService = (audience: ConsultantAudience, value: unknown) => {
  const specialty = typeof value === 'string' ? value.trim() : '';
  return CONSULTANT_DIRECTORY.some((item) => item.value === specialty && item.audiences.includes(audience)) ? specialty : null;
};

export const canonicalConsultantPayload = (payload: FrozenConsultantPayload) => JSON.stringify({
  assignmentId: payload.assignmentId,
  audience: payload.audience,
  specialty: payload.specialty,
  message: payload.message,
});

export const consultantPayloadMatches = (stored: StoredConsultantPayload, incoming: FrozenConsultantPayload) => (
  stored.assignmentId === incoming.assignmentId
  && stored.audience === incoming.audience
  && stored.specialty === incoming.specialty
  && stored.message === incoming.message
);

export const decideConsultantRequestReplay = (
  storedClientRequestId: string,
  storedPayload: StoredConsultantPayload,
  incomingClientRequestId: string,
  incomingPayload: FrozenConsultantPayload,
) => {
  if (storedClientRequestId !== incomingClientRequestId) return 'new' as const;
  return consultantPayloadMatches(storedPayload, incomingPayload) ? 'replay' as const : 'conflict' as const;
};

export const consultantEpisodeKey = (payload: Pick<FrozenConsultantPayload, 'assignmentId' | 'audience' | 'specialty'>) => (
  `${payload.assignmentId}:${payload.audience}:${payload.specialty}`
);

export const hashConsultantPayload = async (payload: FrozenConsultantPayload) => {
  const bytes = new TextEncoder().encode(canonicalConsultantPayload(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
