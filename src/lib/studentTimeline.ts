import type { Database } from './database.types';

type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];
type AssignmentRow = Database['public']['Tables']['student_room_assignments']['Row'];

export type StudentTimelineEvent = {
  id: string;
  kind: 'message' | 'order' | 'progress-note' | 'hint' | 'patient' | 'consultant';
  label: string;
  timestamp: string | null;
  content: string;
  technical?: boolean;
};

type TimelineOrder = {
  id: string;
  order_name: string;
  category: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  priority: string | null;
  status: string | null;
  instructions: string | null;
  order_time: string | null;
};

type TimelineNote = {
  id: string;
  title: string;
  note_type: string;
  content: string;
  timestamp: string | null;
};

export type ExternalTimelineMessage = {
  id: string;
  role: string;
  content: string;
  created_at: string | null;
};

const normalizeTimestamp = (value: string | null | undefined) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const sortTimestamp = (value: string | null) => value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;

const roleLabel = (role: string) => {
  if (role === 'student' || role === 'user') return 'Student message';
  return 'Nurse message';
};

export const buildStudentTimeline = (
  messages: ChatMessage[],
  orders: TimelineOrder[],
  notes: TimelineNote[],
  assignment: Pick<AssignmentRow, 'id' | 'student_progress_note' | 'completed_at' | 'completion_hint_views'>,
  external: { patient?: ExternalTimelineMessage[]; consultant?: ExternalTimelineMessage[] } = {},
): StudentTimelineEvent[] => {
  const events: StudentTimelineEvent[] = [];

  messages.forEach((message) => {
    const timestamp = normalizeTimestamp(message.created_at);
    if (message.content === '<completed>' && message.role === 'assistant') {
      return;
    }
    events.push({
      id: `message-${message.id}`,
      kind: 'message',
      label: roleLabel(message.role),
      timestamp,
      content: message.content,
    });
  });

  orders.forEach((order) => {
    const details = [
      order.order_name,
      order.category,
      order.dose,
      order.route,
      order.frequency,
      order.priority,
      order.status,
      order.instructions,
    ].filter(Boolean).join(' · ');
    events.push({
      id: `order-${order.id}`,
      kind: 'order',
      label: 'Medical order',
      timestamp: normalizeTimestamp(order.order_time),
      content: details,
    });
  });

  notes.forEach((note) => {
    events.push({
      id: `note-${note.id}`,
      kind: 'progress-note',
      label: note.note_type === 'Progress' ? 'Progress note' : note.title || note.note_type,
      timestamp: normalizeTimestamp(note.timestamp),
      content: note.content,
    });
  });

  if (assignment.student_progress_note?.trim()) {
    events.push({
      id: `assignment-progress-note-${assignment.id}`,
      kind: 'progress-note',
      label: 'Student progress note',
      timestamp: normalizeTimestamp(assignment.completed_at),
      content: assignment.student_progress_note.trim(),
    });
  }

  if (assignment.completion_hint_views && typeof assignment.completion_hint_views === 'object') {
    Object.entries(assignment.completion_hint_views as Record<string, unknown>).forEach(([hint, viewedAt]) => {
      if (typeof viewedAt !== 'string') return;
      events.push({
        id: `hint-${hint}-${viewedAt}`,
        kind: 'hint',
        label: 'Completion hint viewed',
        timestamp: normalizeTimestamp(viewedAt),
        content: hint,
      });
    });
  }

  [...(external.patient ?? [])].forEach((message) => events.push({
    id: `patient-${message.id}`,
    kind: 'patient',
    label: message.role === 'student' || message.role === 'user' ? 'Patient question' : 'Patient reply',
    timestamp: normalizeTimestamp(message.created_at),
    content: message.content,
  }));

  [...(external.consultant ?? [])].forEach((message) => events.push({
    id: `consultant-${message.id}`,
    kind: 'consultant',
    label: message.role === 'student' || message.role === 'user' ? 'Consultant message' : 'Consultant reply',
    timestamp: normalizeTimestamp(message.created_at),
    content: message.content,
  }));

  return events.sort((a, b) => sortTimestamp(a.timestamp) - sortTimestamp(b.timestamp));
};
