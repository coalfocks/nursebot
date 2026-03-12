import type { Database } from '../lib/database.types';
import type { ImagingStudy, LabResult, MedicalOrder, VitalSigns } from '../features/emr/lib/types';

export type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];

export type AssignmentTimelineRow = Pick<
  Database['public']['Tables']['student_room_assignments']['Row'],
  'status' | 'student_progress_note' | 'completed_at' | 'completion_hint_views'
>;

export type TimelineEntry =
  | {
      id: string;
      kind: 'message';
      timestamp: string;
      message: ChatMessage;
    }
  | {
      id: string;
      kind: 'completion';
      timestamp: string;
    }
  | {
      id: string;
      kind: 'order';
      timestamp: string;
      order: MedicalOrder;
    }
  | {
      id: string;
      kind: 'labs';
      timestamp: string;
      labs: LabResult[];
    }
  | {
      id: string;
      kind: 'vital';
      timestamp: string;
      vital: VitalSigns;
    }
  | {
      id: string;
      kind: 'imaging';
      timestamp: string;
      study: ImagingStudy;
    }
  | {
      id: string;
      kind: 'progress-note';
      timestamp: string;
      content: string;
    };

const BASELINE_SENTINEL_PREFIX = '2000-01-01';

export const normalizeTimestamp = (timestamp?: string | null) => {
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

export const getLabTimelineTimestamp = (lab: LabResult) => {
  const primary = normalizeTimestamp(lab.resultTime ?? lab.collectionTime ?? lab.createdAt);
  if (primary?.startsWith(BASELINE_SENTINEL_PREFIX)) {
    return normalizeTimestamp(lab.createdAt) ?? primary;
  }
  return primary;
};

export const getImagingTimelineTimestamp = (study: ImagingStudy) =>
  normalizeTimestamp(study.reportGeneratedAt ?? study.orderTime);

const getTimelineSortValue = (timestamp: string) => {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const getTimelineKindRank = (kind: TimelineEntry['kind']) => {
  switch (kind) {
    case 'message':
      return 1;
    case 'order':
      return 2;
    case 'labs':
      return 3;
    case 'vital':
      return 4;
    case 'imaging':
      return 5;
    case 'completion':
      return 6;
    case 'progress-note':
      return 7;
    default:
      return 99;
  }
};

export const buildTimelineEntries = (
  messages: ChatMessage[],
  orders: MedicalOrder[],
  labs: LabResult[],
  vitals: VitalSigns[],
  imagingStudies: ImagingStudy[],
  assignmentTimeline: AssignmentTimelineRow | null,
): TimelineEntry[] => {
  const entries: TimelineEntry[] = [];

  messages.forEach((message) => {
    const timestamp = normalizeTimestamp(message.created_at);
    if (!timestamp) return;
    if (message.content === '<completed>' && message.role === 'assistant') {
      entries.push({
        id: `completion-${message.id ?? timestamp}`,
        kind: 'completion',
        timestamp,
      });
      return;
    }
    entries.push({
      id: `message-${message.id ?? `${message.assignment_id}-${timestamp}`}`,
      kind: 'message',
      timestamp,
      message,
    });
  });

  orders.forEach((order) => {
    const timestamp = normalizeTimestamp(order.orderTime);
    if (!timestamp) return;
    entries.push({
      id: `order-${order.id}`,
      kind: 'order',
      timestamp,
      order,
    });
  });

  const groupedLabs = new Map<string, LabResult[]>();
  labs.forEach((lab) => {
    const timestamp = getLabTimelineTimestamp(lab);
    if (!timestamp) return;
    const key = `${lab.overrideScope ?? 'baseline'}-${timestamp.slice(0, 16)}`;
    const existing = groupedLabs.get(key) ?? [];
    existing.push(lab);
    groupedLabs.set(key, existing);
  });

  groupedLabs.forEach((group, key) => {
    const timestamp = getLabTimelineTimestamp(group[0]);
    if (!timestamp) return;
    group.sort((a, b) => a.testName.localeCompare(b.testName));
    entries.push({
      id: `labs-${key}`,
      kind: 'labs',
      timestamp,
      labs: group,
    });
  });

  vitals.forEach((vital) => {
    const timestamp = normalizeTimestamp(vital.timestamp);
    if (!timestamp) return;
    entries.push({
      id: `vital-${vital.id}`,
      kind: 'vital',
      timestamp,
      vital,
    });
  });

  imagingStudies.forEach((study) => {
    const timestamp = getImagingTimelineTimestamp(study);
    if (!timestamp) return;
    entries.push({
      id: `imaging-${study.id}`,
      kind: 'imaging',
      timestamp,
      study,
    });
  });

  if (assignmentTimeline?.student_progress_note?.trim()) {
    const timestamp = normalizeTimestamp(assignmentTimeline.completed_at) ?? new Date().toISOString();
    entries.push({
      id: `progress-note-${timestamp}`,
      kind: 'progress-note',
      timestamp,
      content: assignmentTimeline.student_progress_note.trim(),
    });
  }

  return entries.sort((a, b) => {
    if (a.kind === 'progress-note' && b.kind !== 'progress-note') return 1;
    if (b.kind === 'progress-note' && a.kind !== 'progress-note') return -1;
    const timestampDiff = getTimelineSortValue(a.timestamp) - getTimelineSortValue(b.timestamp);
    if (timestampDiff !== 0) return timestampDiff;
    return getTimelineKindRank(a.kind) - getTimelineKindRank(b.kind);
  });
};
