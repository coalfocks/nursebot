import { readBaselineSnapshot, renderBaselineReference } from '../../supabase/functions/_shared/baseline-snapshot';
import { eventContent, type AssignmentTimelineEvent } from './assignmentEventManifest';

// Readable chronological view of an assignment's captured activity, for the admin evidence timeline.
// The reference block (verified baseline medications and orders) comes first. Bedside visits and
// hint openings are separate entries so a hint click is never read as a bedside visit.

export type ReadableTimelineEntry = {
  eventId: string;
  time: string;
  category: 'bedside' | 'hint' | 'order' | 'message' | 'result' | 'note' | 'completion' | 'other';
  heading: string;
  actor: string;
  channel: string;
  details: string[];
  ordering_ambiguous: boolean;
};

// Lines for the "Patient medications and active orders before case start" block. A missing or
// malformed snapshot is reported as unavailable; the current chart is never substituted.
export const baselineReferenceLines = (row: Record<string, unknown> | null | undefined, loadError?: string | null): string[] => {
  if (loadError) return [`Patient medications and active orders before case start: unavailable (the baseline could not be read: ${loadError}).`];
  const reference = readBaselineSnapshot(row ?? null);
  return reference.status === 'captured' ? renderBaselineReference(reference) : [`Patient medications and active orders before case start: unavailable (${reference.reason})`];
};

const actorLabel = (role: string | null | undefined) => {
  const value = (role ?? '').toLowerCase();
  if (value === 'student' || value === 'user' || value === 'learner') return 'Learner';
  if (value === 'assistant' || value === 'nurse') return 'Nurse';
  if (value === 'patient') return 'Patient';
  if (value === 'consultant') return 'Consultant';
  if (value === '' || value === 'unknown') return 'Actor not recorded';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value));

export const describeTimelineEvent = (event: AssignmentTimelineEvent): ReadableTimelineEntry => {
  const content = event.content ?? {};
  const base = {
    eventId: event.event_id,
    time: event.occurred_at ? `${new Date(event.occurred_at).toLocaleString()}${event.timezone ? ` ${event.timezone}` : ''}` : 'Time not recorded',
    actor: actorLabel(event.actor?.role),
    channel: event.channel ?? '',
    ordering_ambiguous: event.ordering_ambiguous === true,
  };
  if (event.event_type === 'bedside_action' && event.channel === 'bedside') {
    return { ...base, category: 'bedside', heading: 'Went to bedside (simulated bedside assessment)', details: [eventContent(event)].filter(Boolean) };
  }
  if (event.event_type === 'hint_shown') {
    return { ...base, category: 'hint', heading: 'Hint opened (not a bedside visit)', details: [eventContent(event)].filter(Boolean) };
  }
  if (event.event_type === 'order_placed') {
    const details = [
      text(content.category) && `Category: ${text(content.category)}`,
      text(content.priority) && `Priority: ${text(content.priority)}`,
      text(content.dose) && `Dose: ${text(content.dose)}`,
      text(content.route) && `Route: ${text(content.route)}`,
      text(content.frequency) && `Frequency: ${text(content.frequency)}`,
      text(content.status) && `Status: ${text(content.status)}`,
      text(content.instructions) && `Instructions: ${text(content.instructions)}`,
    ].filter((line): line is string => Boolean(line));
    return { ...base, category: 'order', heading: `Order: ${text(content.name) || 'unnamed order'}`, details };
  }
  if (event.event_type === 'lab_result' || event.event_type === 'imaging_result' || event.event_type === 'vital_observed') {
    return { ...base, category: 'result', heading: event.event_type === 'vital_observed' ? 'Vitals recorded' : 'Result available', details: [eventContent(event)].filter(Boolean) };
  }
  if (event.event_type === 'progress_note') {
    return { ...base, category: 'note', heading: 'Completed progress note', details: [eventContent(event)].filter(Boolean) };
  }
  if (event.event_type === 'assignment_completed') {
    return { ...base, category: 'completion', heading: 'Case completed', details: [] };
  }
  const messageHeadings: Record<string, string> = {
    student_message: 'Learner message', nurse_message: 'Nurse message', nurse_chat: 'Nurse message', patient_message: 'Patient message',
    consultant_request: 'Consult request', consultant_message: 'Consult request', consultant_response: 'Consultant response',
  };
  if (messageHeadings[event.event_type]) {
    return { ...base, category: 'message', heading: messageHeadings[event.event_type], details: [eventContent(event)].filter(Boolean) };
  }
  return { ...base, category: 'other', heading: event.event_type.replace(/_/g, ' '), details: [eventContent(event)].filter(Boolean) };
};

// The manifest already sorts by time; re-sorting here keeps the order stable for same-time events
// and puts untimed events last instead of asserting a position for them.
export const buildReadableTimeline = (events: AssignmentTimelineEvent[]): ReadableTimelineEntry[] => [...events]
  .sort((a, b) => {
    const at = a.occurred_at ? Date.parse(a.occurred_at) : Number.POSITIVE_INFINITY;
    const bt = b.occurred_at ? Date.parse(b.occurred_at) : Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return (a.sequence ?? 0) - (b.sequence ?? 0);
  })
  .map(describeTimelineEvent);
