import type { EvaluationTimelineEntry } from './assignment-timeline.ts';

// Maps one canonical assignment-manifest event to the evaluation timeline.
// Actor and channel come from structured fields only. Bedside and nurse events
// keep their own actor, channel, id, and timestamp. Consultant advice stays
// context and is never converted into a learner action.
const channelOf = (event: Record<string, unknown>) => typeof event.channel === 'string' ? event.channel : null;

export const manifestEventToEvaluationEntry = (event: Record<string, unknown>): EvaluationTimelineEntry | null => {
  const eventType = String(event.event_type ?? '');
  const kind: EvaluationTimelineEntry['kind'] = eventType === 'order_placed'
    ? 'order'
    : eventType === 'lab_result'
      ? 'labs'
      : eventType === 'vital_observed'
        ? 'vital'
        : eventType === 'imaging_result'
          ? 'imaging'
          : eventType === 'progress_note'
            ? 'progress-note'
            : eventType === 'bedside_action'
              ? 'learner-action'
              : eventType === 'hint_shown'
                ? 'hint'
                : eventType === 'assignment_completed'
                ? 'completion'
                : eventType === 'consultant_request' || eventType === 'consultant_message' || eventType === 'consultant_response'
                  ? 'consultant-message'
                  : 'message';
  const title = eventType === 'bedside_action' && channelOf(event) === 'bedside'
    ? 'Bedside visit'
    : eventType === 'hint_shown'
      ? 'Hint opened'
      : eventType === 'student_message'
    ? 'Student message'
    : eventType === 'nurse_message'
      ? 'Nurse message'
      : eventType === 'patient_message'
        ? 'Patient message'
        : eventType === 'consultant_request'
          ? 'Consult request'
          : eventType === 'consultant_response'
            ? 'Consultant response'
            : eventType;
  const content = event.content && typeof event.content === 'object' ? event.content as Record<string, unknown> : {};
  const text = typeof content.text === 'string' ? content.text : Object.entries(content)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' | ');
  const actor = event.actor && typeof event.actor === 'object' ? event.actor as Record<string, unknown> : {};
  const channel = typeof event.channel === 'string' ? event.channel : null;
  const service = event.service && typeof event.service === 'object' ? event.service as Record<string, unknown> : {};
  const actorRole = String(actor.role ?? '').toLowerCase();
  const meta = [
    actor.role ? `Actor: ${actor.role}` : null,
    actorRole === 'student' || actorRole === 'user' ? 'Author: Student' : null,
    actorRole === 'assistant' || actorRole === 'nurse' ? 'Author: Nurse' : null,
    actorRole === 'consultant' ? 'Author: Consultant' : null,
    actorRole === 'patient' ? 'Author: Patient' : null,
    channel ? `Channel: ${channel}` : null,
    service.label ? `Service: ${service.label}` : null,
    service.audience ? `Audience: ${service.audience}` : null,
    service.urgency ? `Urgency: ${service.urgency}` : null,
    eventType === 'hint_shown' ? 'System hint shown; not a learner action' : null,
    event.ordering_ambiguous ? 'Same-time ordering ambiguous; no clinical sequence asserted' : null,
  ].filter((value): value is string => Boolean(value));
  const timestamp = typeof event.occurred_at === 'string' ? event.occurred_at : null;
  const id = typeof event.event_id === 'string' ? event.event_id : null;
  if (!id) return null;
  return {
    id,
    kind,
    timestamp,
    title,
    body: text || undefined,
    meta,
    actor_role: typeof actor.role === 'string' ? actor.role.toLowerCase() : null,
    channel,
    sequence: typeof event.sequence === 'number' ? event.sequence : null,
    ordering_ambiguous: event.ordering_ambiguous === true,
    assignment_linked: Boolean(event.links && typeof event.links === 'object' && typeof (event.links as Record<string, unknown>).assignment_id === 'string'),
  };
};
