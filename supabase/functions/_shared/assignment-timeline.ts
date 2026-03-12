export type TimelineScope = 'baseline' | 'room' | 'assignment';

export type TimelineChatMessageRow = {
  id: string | number | null;
  assignment_id: string | null;
  role: string;
  content: string;
  created_at: string | null;
};

export type TimelineOrderRow = {
  id: string;
  assignment_id: string | null;
  room_id: number | null;
  override_scope: string | null;
  category: string;
  order_name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  priority: string | null;
  status: string | null;
  instructions: string | null;
  order_time: string | null;
  created_at: string | null;
  deleted_at?: string | null;
};

export type TimelineLabRow = {
  id: string;
  assignment_id: string | null;
  room_id: number | null;
  override_scope: string | null;
  test_name: string;
  value: number | null;
  unit: string | null;
  status: string | null;
  collection_time: string | null;
  result_time: string | null;
  created_at: string | null;
  deleted_at?: string | null;
};

export type TimelineVitalRow = {
  id: string;
  assignment_id: string | null;
  room_id: number | null;
  override_scope: string | null;
  timestamp: string | null;
  temperature: number | null;
  blood_pressure_systolic: number | null;
  blood_pressure_diastolic: number | null;
  heart_rate: number | null;
  respiratory_rate: number | null;
  oxygen_saturation: number | null;
  pain: number | null;
  deleted_at?: string | null;
};

export type TimelineImagingRow = {
  id: string;
  assignment_id: string | null;
  room_id: number | null;
  override_scope: string | null;
  order_name: string | null;
  study_type: string;
  status: string | null;
  report: string | null;
  order_time: string | null;
  report_generated_at: string | null;
  created_at: string | null;
  deleted_at?: string | null;
};

export type TimelineAssignmentSummary = {
  id: string;
  completed_at: string | null;
  student_progress_note: string | null;
};

export type EvaluationTimelineEntry = {
  id: string;
  kind: 'message' | 'completion' | 'order' | 'labs' | 'vital' | 'imaging' | 'progress-note';
  timestamp: string;
  title: string;
  body?: string;
  meta?: string[];
};

const BASELINE_SENTINEL_PREFIX = '2000-01-01';

export const normalizeTimelineTimestamp = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

export const deriveTimelineScope = (
  overrideScope: string | null | undefined,
  assignmentId?: string | null,
  roomId?: number | null,
): TimelineScope => {
  if (overrideScope === 'assignment' || overrideScope === 'room' || overrideScope === 'baseline') {
    return overrideScope;
  }
  if (assignmentId) return 'assignment';
  if (roomId) return 'room';
  return 'baseline';
};

export const timelineScopeMatchesContext = (
  scope: TimelineScope,
  rowRoomId: number | null,
  targetRoomIds: number[] | null,
  rowAssignmentId?: string | null,
  targetAssignmentId?: string | null,
) => {
  if (scope === 'assignment') {
    return Boolean(targetAssignmentId && rowAssignmentId === targetAssignmentId);
  }
  if (scope === 'room') {
    if (!targetRoomIds || targetRoomIds.length === 0) return true;
    return targetRoomIds.includes(rowRoomId ?? -1);
  }
  return true;
};

const getLabTimelineTimestamp = (lab: TimelineLabRow) => {
  const primary = normalizeTimelineTimestamp(lab.result_time ?? lab.collection_time ?? lab.created_at);
  if (primary?.startsWith(BASELINE_SENTINEL_PREFIX)) {
    return normalizeTimelineTimestamp(lab.created_at) ?? primary;
  }
  return primary;
};

const getImagingTimelineTimestamp = (study: TimelineImagingRow) =>
  normalizeTimelineTimestamp(study.report_generated_at ?? study.order_time ?? study.created_at);

const getTimelineSortValue = (timestamp: string) => {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const getTimelineKindRank = (kind: EvaluationTimelineEntry['kind']) => {
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

export const buildAssignmentTimelineEntries = ({
  assignment,
  assignmentId,
  targetRoomIds,
  messages,
  orders,
  labs,
  vitals,
  imaging,
}: {
  assignment: TimelineAssignmentSummary;
  assignmentId: string;
  targetRoomIds: number[] | null;
  messages: TimelineChatMessageRow[];
  orders: TimelineOrderRow[];
  labs: TimelineLabRow[];
  vitals: TimelineVitalRow[];
  imaging: TimelineImagingRow[];
}): EvaluationTimelineEntry[] => {
  const entries: EvaluationTimelineEntry[] = [];

  for (const message of messages) {
    const timestamp = normalizeTimelineTimestamp(message.created_at);
    if (!timestamp) continue;
    if (message.content === '<completed>' && message.role === 'assistant') {
      entries.push({
        id: `completion-${message.id ?? timestamp}`,
        kind: 'completion',
        timestamp,
        title: 'Case completed',
      });
      continue;
    }
    entries.push({
      id: `message-${message.id ?? `${message.assignment_id ?? assignmentId}-${timestamp}`}`,
      kind: 'message',
      timestamp,
      title: message.role === 'student' || message.role === 'user' ? 'Student message' : 'Nurse message',
      body: message.content,
      meta: [message.role === 'student' || message.role === 'user' ? 'Author: Student' : 'Author: Nurse'],
    });
  }

  const filteredOrders = orders.filter((row) =>
    timelineScopeMatchesContext(
      deriveTimelineScope(row.override_scope, row.assignment_id, row.room_id),
      row.room_id,
      targetRoomIds,
      row.assignment_id,
      assignmentId,
    ),
  );

  for (const order of filteredOrders) {
    const timestamp = normalizeTimelineTimestamp(order.order_time ?? order.created_at);
    if (!timestamp) continue;
    const details = [order.dose, order.route, order.frequency].filter(Boolean).join(' • ');
    entries.push({
      id: `order-${order.id}`,
      kind: 'order',
      timestamp,
      title: `Order: ${order.order_name}`,
      body: details || order.instructions || undefined,
      meta: [order.category, order.priority ?? 'Routine', order.status ?? 'Active'],
    });
  }

  const filteredLabs = labs.filter((row) =>
    timelineScopeMatchesContext(
      deriveTimelineScope(row.override_scope, row.assignment_id, row.room_id),
      row.room_id,
      targetRoomIds,
      row.assignment_id,
      assignmentId,
    ),
  );

  const groupedLabs = new Map<string, TimelineLabRow[]>();
  for (const lab of filteredLabs) {
    const timestamp = getLabTimelineTimestamp(lab);
    if (!timestamp) continue;
    const key = `${deriveTimelineScope(lab.override_scope, lab.assignment_id, lab.room_id)}-${timestamp.slice(0, 16)}`;
    const existing = groupedLabs.get(key) ?? [];
    existing.push(lab);
    groupedLabs.set(key, existing);
  }

  groupedLabs.forEach((group, key) => {
    const timestamp = getLabTimelineTimestamp(group[0]);
    if (!timestamp) return;
    group.sort((a, b) => a.test_name.localeCompare(b.test_name));
    entries.push({
      id: `labs-${key}`,
      kind: 'labs',
      timestamp,
      title: `Lab results (${group.length})`,
      body: group
        .map((lab) => {
          if (lab.status === 'Pending') return `${lab.test_name}: pending`;
          const unit = lab.unit ? ` ${lab.unit}` : '';
          const value = lab.value === null ? 'resulted' : `${lab.value}${unit}`;
          return `${lab.test_name}: ${value}`;
        })
        .join('\n'),
      meta: Array.from(new Set(group.map((lab) => lab.status ?? 'Unknown'))),
    });
  });

  const filteredVitals = vitals.filter((row) =>
    timelineScopeMatchesContext(
      deriveTimelineScope(row.override_scope, row.assignment_id, row.room_id),
      row.room_id,
      targetRoomIds,
      row.assignment_id,
      assignmentId,
    ),
  );

  for (const vital of filteredVitals) {
    const timestamp = normalizeTimelineTimestamp(vital.timestamp);
    if (!timestamp) continue;
    const details = [
      vital.temperature !== null ? `T ${vital.temperature}` : null,
      vital.blood_pressure_systolic !== null && vital.blood_pressure_diastolic !== null
        ? `BP ${vital.blood_pressure_systolic}/${vital.blood_pressure_diastolic}`
        : null,
      vital.heart_rate !== null ? `HR ${vital.heart_rate}` : null,
      vital.respiratory_rate !== null ? `RR ${vital.respiratory_rate}` : null,
      vital.oxygen_saturation !== null ? `SpO2 ${vital.oxygen_saturation}%` : null,
      vital.pain !== null ? `Pain ${vital.pain}/10` : null,
    ]
      .filter(Boolean)
      .join(' • ');

    entries.push({
      id: `vital-${vital.id}`,
      kind: 'vital',
      timestamp,
      title: 'Vitals updated',
      body: details || undefined,
    });
  }

  const filteredImaging = imaging.filter((row) =>
    timelineScopeMatchesContext(
      deriveTimelineScope(row.override_scope, row.assignment_id, row.room_id),
      row.room_id,
      targetRoomIds,
      row.assignment_id,
      assignmentId,
    ),
  );

  for (const study of filteredImaging) {
    const timestamp = getImagingTimelineTimestamp(study);
    if (!timestamp) continue;
    entries.push({
      id: `imaging-${study.id}`,
      kind: 'imaging',
      timestamp,
      title: `Imaging: ${study.order_name || study.study_type}`,
      body: study.report || undefined,
      meta: [study.study_type, study.status ?? 'Result available'],
    });
  }

  if (assignment.student_progress_note?.trim()) {
    const timestamp = normalizeTimelineTimestamp(assignment.completed_at) ?? new Date().toISOString();
    entries.push({
      id: `progress-note-${assignment.id}`,
      kind: 'progress-note',
      timestamp,
      title: 'Student progress note',
      body: assignment.student_progress_note.trim(),
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

export const renderTimelineEntriesForEvaluation = (entries: EvaluationTimelineEntry[]) => {
  if (!entries.length) return 'No timeline events available.';

  return entries
    .map((entry) => {
      const parts = [`[${entry.timestamp}] ${entry.title}`];
      if (entry.meta?.length) {
        parts.push(`Meta: ${entry.meta.join(' | ')}`);
      }
      if (entry.body?.trim()) {
        parts.push(`Details:\n${entry.body.trim()}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');
};
