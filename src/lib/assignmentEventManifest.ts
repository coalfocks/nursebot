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

export const eventContent = (event: AssignmentTimelineEvent) =>
  Object.entries(event.content ?? {}).filter(([, value]) => value != null && value !== '').map(([key, value]) => `${key}: ${scalar(value)}`).join(' | ');

export const eventLabel = (event: AssignmentTimelineEvent) => {
  const service = event.service?.label ? ` · ${event.service.label}` : '';
  const urgency = event.service?.urgency ? ` · ${event.service.urgency}` : '';
  const ambiguous = event.ordering_ambiguous ? ' · same-time order ambiguous' : '';
  return `${event.event_type}${service}${urgency}${ambiguous}`;
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
  URL.revokeObjectURL(url);
};
