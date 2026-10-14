export type PatientChatRequestState = {
  status: 'pending' | 'completed' | 'failed';
  lease_expires_at: string | null;
};

export type ExistingPatientChatRequestDecision = 'completed' | 'processing' | 'reclaim';

export const decideExistingPatientChatRequest = (
  request: PatientChatRequestState,
  now: string,
): ExistingPatientChatRequestDecision => {
  if (request.status === 'completed') return 'completed';
  if (
    request.status === 'pending' &&
    request.lease_expires_at &&
    request.lease_expires_at > now
  ) {
    return 'processing';
  }
  return 'reclaim';
};
