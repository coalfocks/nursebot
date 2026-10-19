import type { ConsultantAudience } from './consultant-transport.ts';

export type ConsultantOrderLookup = {
  assignmentId: string;
  audience: ConsultantAudience;
  specialty: string;
  category: 'Consult';
  overrideScope: 'assignment';
  status: 'Active';
  deletedAt: null;
};

export const buildConsultantOrderLookup = ({ assignmentId, audience, specialty }: Pick<ConsultantOrderLookup, 'assignmentId' | 'audience' | 'specialty'>): ConsultantOrderLookup => ({
  assignmentId,
  audience,
  specialty,
  category: 'Consult',
  overrideScope: 'assignment',
  status: 'Active',
  deletedAt: null,
});

export const decideConsultantOrderPersistence = <T extends { id: string }>(existing: T | null) => (
  existing ? { action: 'reuse' as const, order: existing } : { action: 'create' as const }
);
