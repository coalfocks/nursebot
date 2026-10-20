import type { MedicalOrder, MarAdministrationEvent, MarCategory } from './types';
import { expandMarSchedule, type MarDraftOccurrence } from './marSchedule';

export const MAR_HISTORY_OPTIONS = [12, 24, 36, 48, 60, 72] as const;
export type MarHistoryHours = typeof MAR_HISTORY_OPTIONS[number];

export type CaseMedicationDraft = {
  startPriorHours: string;
  startPriorHoursEdited?: boolean;
  stopPriorHours: string;
  explicitPriorHours: string;
  prnGiven: boolean;
  category: MarCategory;
  infusionStartPriorHours: string;
  infusionRate: string;
  infusionChangePriorHours: string;
  infusionChangeRate: string;
  infusionStopPriorHours: string;
  infusionStopRate: string;
};

export const defaultCaseMedicationDraft = (order: MedicalOrder): CaseMedicationDraft => ({
  startPriorHours: '12',
  startPriorHoursEdited: false,
  stopPriorHours: '',
  explicitPriorHours: '',
  prnGiven: false,
  category: medicationCategory(order),
  infusionStartPriorHours: '12',
  infusionRate: '',
  infusionChangePriorHours: '',
  infusionChangeRate: '',
  infusionStopPriorHours: '',
  infusionStopRate: '',
});

export const medicationCategory = (order: MedicalOrder): MarCategory => {
  const frequency = (order.frequency ?? '').trim().toLowerCase();
  const instructions = (order.instructions ?? '').trim().toLowerCase();
  if (frequency === 'prn' || frequency.includes(' prn') || instructions.includes('prn')) return 'prn';
  if (/^once$|one[- ]?time/.test(frequency)) return 'one_time';
  if (frequency.includes('infusion') || frequency.includes('continuous')) return 'infusion';
  return 'scheduled';
};

const parseHours = (value: string, label: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 72) throw new RangeError(`MAR_INVALID_${label}`);
  return parsed;
};

const parseExplicitHours = (value: string): number[] => value.split(',').map((part) => part.trim()).filter(Boolean).map((part) => parseHours(part, 'EXPLICIT_TIME') as number);

export type CaseMarPreview = {
  events: MarDraftOccurrence[];
  errors: string[];
  baseErrors?: string[];
  selectedHistoryHours?: number;
  authoredStayHours?: number;
  orderDefinitionFingerprint: string;
};

const validStatuses: MarDraftOccurrence['status'][] = ['Given', 'Held', 'Refused', 'Not given', 'Started', 'Rate changed', 'Stopped', 'Not documented'];

export const validateMarDraftOccurrence = (
  event: MarDraftOccurrence,
  selectedHistoryHours: number,
  authoredStayHours: number,
): string[] => {
  const errors: string[] = [];
  if (!Number.isFinite(selectedHistoryHours) || selectedHistoryHours < 1 || selectedHistoryHours > 72) errors.push('MAR_INVALID_SELECTED_HISTORY');
  if (!Number.isFinite(authoredStayHours) || authoredStayHours < 1 || authoredStayHours > 72) errors.push('MAR_INVALID_AUTHORED_STAY');
  if (selectedHistoryHours > authoredStayHours) errors.push('MAR_INCOMPATIBLE_SOURCE_STAY');
  if (!Number.isFinite(event.relativeOffsetHours) || event.relativeOffsetHours <= 0) errors.push('MAR_TIME_MUST_PRECEDE_FIRST_PAGE');
  else if (event.relativeOffsetHours > selectedHistoryHours) errors.push('MAR_TIME_OUTSIDE_SELECTED_HISTORY');
  else if (event.relativeOffsetHours > authoredStayHours) errors.push('MAR_TIME_OUTSIDE_AUTHORED_STAY');
  if (!event.orderedDose?.trim() || !event.administeredDose?.trim()) errors.push('MAR_DOSE_REQUIRED');
  if (!validStatuses.includes(event.status)) errors.push('MAR_INVALID_STATUS');
  const needsReason = ['Held', 'Refused', 'Not given'].includes(event.status);
  if (needsReason && !event.reason?.trim()) errors.push('MAR_REASON_REQUIRED');
  if (event.category !== 'infusion' && ['Started', 'Rate changed', 'Stopped'].includes(event.status)) errors.push('MAR_INFUSION_STATUS_REQUIRES_INFUSION');
  if (event.category === 'infusion' && ['Started', 'Rate changed'].includes(event.status)
    && !String(event.infusionDetails?.rate ?? '').trim()) errors.push('MAR_INFUSION_RATE_REQUIRED');
  return [...new Set(errors)];
};

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const fingerprintHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `mar-order-def-v1:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

/** Includes the authored medication set and every field returned for each order. */
export const orderDefinitionFingerprint = (orders: MedicalOrder[]): string => fingerprintHash(
  stableSerialize([...orders].sort((left, right) => left.id.localeCompare(right.id))),
);

export const isRoomScopedAuthoredOrder = (order: MedicalOrder, roomId: number): boolean =>
  order.category === 'Medication'
  && order.assignmentId == null
  && order.roomId === roomId
  && order.overrideScope === 'room';

export const isRoomScopedAuthoredEvent = (event: MarAdministrationEvent, roomId: number): boolean =>
  event.assignmentId == null && event.roomId === roomId && event.source === 'authored_scenario';

export const mergePreviewWithExisting = (
  preview: MarDraftOccurrence[],
  existing: MarAdministrationEvent[],
  preferExisting = true,
): MarDraftOccurrence[] => {
  const existingByKey = new Map(existing.map((event) => [event.occurrenceKey, event]));
  return preview.map((event) => (preferExisting
    ? { ...event, ...(existingByKey.get(event.occurrenceKey) ?? {}) }
    : { ...(existingByKey.get(event.occurrenceKey) ?? {}), ...event }) as MarDraftOccurrence);
};

export const updatePreviewEvent = (
  preview: CaseMarPreview,
  occurrenceKey: string,
  patch: Partial<MarDraftOccurrence>,
): CaseMarPreview => {
  const events = preview.events.map((event) => event.occurrenceKey === occurrenceKey ? { ...event, ...patch } : event);
  const selectedHistoryHours = preview.selectedHistoryHours ?? 72;
  const authoredStayHours = preview.authoredStayHours ?? 72;
  const validationErrors = events.flatMap((event) => validateMarDraftOccurrence(event, selectedHistoryHours, authoredStayHours)
    .map((error) => `${event.medicationName} (${event.occurrenceKey}): ${error}`));
  return { ...preview, events, errors: [...(preview.baseErrors ?? []), ...new Set(validationErrors)] };
};

export const buildCaseMarPreview = (
  orders: MedicalOrder[],
  drafts: Record<string, CaseMedicationDraft>,
  historyHours: MarHistoryHours,
  caseVersion = 'baseline-v1',
  authoredStayHours = historyHours,
): CaseMarPreview => {
  const events: MarDraftOccurrence[] = [];
  const errors: string[] = [];
  orders.forEach((order) => {
    const draft = drafts[order.id] ?? defaultCaseMedicationDraft(order);
    try {
      if (draft.category === 'prn' && !draft.prnGiven) throw new RangeError('MAR_PRN_TIMING_REQUIRED');
      const hasAuthoredStart = draft.startPriorHoursEdited === true || draft.startPriorHours.trim() !== defaultCaseMedicationDraft(order).startPriorHours;
      const start = hasAuthoredStart ? parseHours(draft.startPriorHours, 'START_HOURS') : historyHours;
      if (start === null) throw new RangeError('MAR_START_REQUIRED');
      const stop = parseHours(draft.stopPriorHours, 'STOP_HOURS');
      const explicit = draft.explicitPriorHours.trim() ? parseExplicitHours(draft.explicitPriorHours) : undefined;
      const infusionEvents = draft.category === 'infusion'
        ? [
            { offsetHours: parseHours(draft.infusionStartPriorHours, 'INFUSION_START') ?? start, status: 'Started' as const, rate: draft.infusionRate || undefined },
            ...(draft.infusionChangePriorHours.trim() ? [{ offsetHours: parseHours(draft.infusionChangePriorHours, 'INFUSION_CHANGE') as number, status: 'Rate changed' as const, rate: draft.infusionChangeRate || undefined }] : []),
            ...(draft.infusionStopPriorHours.trim() ? [{ offsetHours: parseHours(draft.infusionStopPriorHours, 'INFUSION_STOP') as number, status: 'Stopped' as const, rate: draft.infusionStopRate || undefined }] : []),
          ]
        : undefined;
      events.push(...expandMarSchedule({
        medicationName: order.orderName,
        orderId: order.id,
        orderedDose: order.dose,
        route: order.route,
        frequency: order.frequency ?? '',
        category: draft.category,
        historyHours,
        stayHours: authoredStayHours,
        startPriorHours: start,
        firstDosePriorHours: start,
        stopPriorHours: stop,
        explicitPriorHours: explicit,
        assumePrnGiven: draft.category === 'prn' ? draft.prnGiven : undefined,
        caseVersion,
        infusionEvents,
      }));
    } catch (error) {
      errors.push(`${order.orderName}: ${error instanceof Error ? error.message : 'Invalid MAR timing'}`);
    }
  });
  const validationErrors = events.flatMap((event) => validateMarDraftOccurrence(event, historyHours, authoredStayHours)
    .map((error) => `${event.medicationName} (${event.occurrenceKey}): ${error}`));
  return {
    events,
    errors: [...errors, ...new Set(validationErrors)],
    baseErrors: errors,
    selectedHistoryHours: historyHours,
    authoredStayHours,
    orderDefinitionFingerprint: orderDefinitionFingerprint(orders),
  };
};

export const authoredEventsToSave = (
  preview: MarDraftOccurrence[],
  existing: MarAdministrationEvent[],
  patientId: string,
  roomId: number,
  caseVersion: string,
  actorLabel: string,
  selectedHistoryHours = 72,
  authoredStayHours = 72,
): MarAdministrationEvent[] => {
  if (preview.some((event) => validateMarDraftOccurrence(event, selectedHistoryHours, authoredStayHours).length)) return [];
  const existingByKey = new Map(existing.map((event) => [event.occurrenceKey, event]));
  return preview.map((event) => ({
    ...(existingByKey.get(event.occurrenceKey) ?? {}),
    ...event,
    id: event.id ?? existingByKey.get(event.occurrenceKey)?.id ?? crypto.randomUUID(),
    patientId,
    roomId,
    assignmentId: null,
    caseVersion,
    administeredAt: existingByKey.get(event.occurrenceKey)?.administeredAt ?? null,
    actorLabel,
    recordVersion: existingByKey.get(event.occurrenceKey)?.recordVersion ?? 1,
  }) as MarAdministrationEvent);
};
