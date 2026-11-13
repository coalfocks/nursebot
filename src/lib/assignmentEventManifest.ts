export type AssignmentTimelineEvent = {
  event_id: string;
  event_type: string;
  actor?: { id?: string | null; role?: string | null } | null;
  channel?: string | null;
  service?: { id?: string | null; label?: string | null; audience?: string | null; urgency?: string | null } | null;
  occurred_at: string | null;
  timezone?: string | null;
  elapsed_seconds?: number | null;
  sequence?: number | null;
  ordering_ambiguous?: boolean;
  content?: Record<string, unknown> | null;
  links?: Record<string, unknown> | null;
  provenance?: Record<string, unknown> | null;
};

export type AssignmentEventManifest = {
  manifest_version: number;
  assignment_id: string;
  generated_at: string;
  scoring_boundary?: Record<string, unknown> | null;
  events: AssignmentTimelineEvent[];
  gaps: string[];
  feedback?: Record<string, unknown> | null;
};

const scalar = (value: unknown) => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

const readableKey = (key: string) => key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export const eventContent = (event: AssignmentTimelineEvent) => {
  const content = event.content ?? {};
  const directText = content.text ?? content.message ?? content.content ?? content.note;
  if (typeof directText === 'string' && directText.trim()) {
    const rest = Object.entries(content).filter(([key, value]) => !['text', 'message', 'content', 'note'].includes(key) && value != null && value !== '')
      .map(([key, value]) => `${readableKey(key)}: ${scalar(value)}`);
    return [directText.trim(), ...rest].join('\n');
  }
  return Object.entries(content)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${readableKey(key)}: ${scalar(value)}`)
    .join('\n');
};

export const eventLabel = (event: AssignmentTimelineEvent) => {
  const labels: Record<string, string> = {
    student_message: 'Student message', nurse_message: 'Nurse message', nurse_chat: 'Nurse message',
    patient_message: 'Patient message', consultant_request: 'Consult request', consultant_message: 'Consult request',
    consultant_response: 'Consultant response', hint_shown: 'Hint viewed', order_placed: 'Order placed',
    lab_result: 'Lab result', imaging_result: 'Imaging result', medication_ordered: 'Medication ordered',
    progress_note: 'Progress note', assignment_completed: 'Case completed', bedside_action: 'Bedside action',
    vital_observed: 'Vitals recorded', assignment_created: 'Assignment started',
  };
  const kind = labels[event.event_type] ?? readableKey(event.event_type);
  const detail = event.service?.label ? ` · ${event.service.label}` : '';
  const urgency = event.service?.urgency ? ` (${event.service.urgency})` : '';
  const ambiguity = event.ordering_ambiguous ? ' · same-time order ambiguous' : '';
  return `${kind}${detail}${urgency}${ambiguity}`;
};

export const manifestToCsv = (manifest: AssignmentEventManifest) => {
  const headers = ['event_id', 'event_type', 'actor_role', 'channel', 'service_id', 'service_label', 'audience', 'urgency', 'occurred_at', 'timezone', 'elapsed_seconds', 'sequence', 'ordering_ambiguous', 'content', 'links', 'provenance'];
  const quote = (value: unknown) => `"${scalar(value).replaceAll('"', '""')}"`;
  const rows = manifest.events.map((event) => [
    event.event_id,
    event.event_type,
    event.actor?.role,
    event.channel,
    event.service?.id,
    event.service?.label,
    event.service?.audience,
    event.service?.urgency,
    event.occurred_at,
    event.timezone,
    event.elapsed_seconds,
    event.sequence,
    event.ordering_ambiguous,
    event.content,
    event.links,
    event.provenance,
  ].map(quote).join(','));
  return [headers.join(','), ...rows].join('\n');
};

export const downloadText = (filename: string, content: string, mimeType: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};
