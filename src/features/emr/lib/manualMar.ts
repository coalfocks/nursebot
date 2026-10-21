import type { MarAdministrationEvent, MarCategory, MarStatus } from './types';

export type ManualMarPacket = {
  id: string;
  patientId: string;
  roomId: number;
  caseVersion: string;
  revision: number;
  events: MarAdministrationEvent[];
  updatedAt?: string | null;
};

export type ManualMarReadiness = {
  available: boolean;
  ready: boolean;
  schemaVersion?: number;
  error?: string;
};

export type ManualMarPacketResult =
  | { status: 'ready'; packet: ManualMarPacket }
  | { status: 'empty'; packet: null }
  | { status: 'unavailable' | 'error'; packet: null; error?: string };

export const manualMarCanEdit = (role: string | null | undefined, readOnly: boolean, schemaReady: boolean, assignmentId?: string): boolean =>
  (role === 'school_admin' || role === 'super_admin') && !readOnly && schemaReady && !assignmentId;

/** Position an authored prior-hour event on the 0–72h timeline without rounding it. */
export const manualMarTimelinePositionPercent = (relativeOffsetHours: number): number =>
  (relativeOffsetHours / 72) * 100;

const categories = new Set<MarCategory>(['scheduled', 'prn', 'one_time', 'infusion']);
const statuses = new Set<MarStatus>(['Given', 'Held', 'Refused', 'Not given', 'Started', 'Rate changed', 'Stopped', 'Not documented']);

export const validateManualMarEvents = (events: unknown): asserts events is Array<Record<string, unknown>> => {
  if (!Array.isArray(events)) throw new Error('MANUAL_MAR_EVENTS_ARRAY_REQUIRED');
  for (const event of events) {
    if (!event || typeof event !== 'object') throw new Error('MANUAL_MAR_EVENT_OBJECT_REQUIRED');
    const row = event as Record<string, unknown>;
    if (typeof row.medicationName !== 'string' || !row.medicationName.trim()) throw new Error('MANUAL_MAR_MEDICATION_REQUIRED');
    if (typeof row.occurrenceKey !== 'string' || !row.occurrenceKey.trim()) throw new Error('MANUAL_MAR_OCCURRENCE_REQUIRED');
    if (!categories.has(row.category as MarCategory)) throw new Error('MANUAL_MAR_CATEGORY_INVALID');
    if (!statuses.has(row.status as MarStatus)) throw new Error('MANUAL_MAR_STATUS_INVALID');
    if (row.source === 'learner') throw new Error('MANUAL_MAR_LEARNER_SOURCE_REJECTED');
    if (row.orderId !== undefined && row.orderId !== null && row.orderId !== '') throw new Error('MANUAL_MAR_ORDER_ID_NOT_ALLOWED');
    if (row.relativeOffsetHours !== null && row.relativeOffsetHours !== undefined) {
      if (typeof row.relativeOffsetHours !== 'number' || !Number.isFinite(row.relativeOffsetHours) || row.relativeOffsetHours < 0 || row.relativeOffsetHours > 72) {
        throw new Error('MANUAL_MAR_RELATIVE_HOURS_INVALID');
      }
    }
  }
};

export const mapManualMarEvent = (row: Record<string, unknown>, patientId: string, roomId: number, caseVersion: string, revision: number): MarAdministrationEvent => ({
  id: typeof row.id === 'string' && row.id ? row.id : `${row.occurrenceKey}`,
  patientId,
  roomId,
  assignmentId: null,
  orderId: null,
  caseVersion,
  occurrenceKey: String(row.occurrenceKey),
  relativeOffsetHours: typeof row.relativeOffsetHours === 'number' ? row.relativeOffsetHours : null,
  administeredAt: typeof row.administeredAt === 'string' ? row.administeredAt : null,
  medicationName: String(row.medicationName),
  orderedDose: typeof row.orderedDose === 'string' ? row.orderedDose : null,
  administeredDose: typeof row.administeredDose === 'string' ? row.administeredDose : null,
  unit: typeof row.unit === 'string' ? row.unit : null,
  route: typeof row.route === 'string' ? row.route : null,
  frequency: typeof row.frequency === 'string' ? row.frequency : null,
  category: row.category as MarCategory,
  status: row.status as MarStatus,
  simulatedClinician: typeof row.simulatedClinician === 'string' ? row.simulatedClinician : null,
  reason: typeof row.reason === 'string' ? row.reason : null,
  prnIndication: typeof row.prnIndication === 'string' ? row.prnIndication : null,
  response: typeof row.response === 'string' ? row.response : null,
  infusionDetails: row.infusionDetails && typeof row.infusionDetails === 'object' ? row.infusionDetails as Record<string, unknown> : null,
  source: row.source === 'simulation' ? 'simulation' : 'authored_scenario',
  actorLabel: typeof row.actorLabel === 'string' ? row.actorLabel : null,
  recordVersion: revision,
});

export const mapManualMarPacket = (value: unknown): ManualMarPacket | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const patientId = typeof row.patientId === 'string' ? row.patientId : '';
  const roomId = typeof row.roomId === 'number' ? row.roomId : NaN;
  const caseVersion = typeof row.caseVersion === 'string' ? row.caseVersion : '';
  const revision = typeof row.revision === 'number' ? row.revision : NaN;
  const rawEvents = Array.isArray(row.events) ? row.events : null;
  if (!patientId || !Number.isInteger(roomId) || !caseVersion || !Number.isInteger(revision) || !rawEvents) return null;
  validateManualMarEvents(rawEvents);
  return {
    id: typeof row.id === 'string' ? row.id : `${patientId}:${roomId}:${caseVersion}`,
    patientId,
    roomId,
    caseVersion,
    revision,
    events: rawEvents.map((event) => mapManualMarEvent(event, patientId, roomId, caseVersion, revision)),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : null,
  };
};
