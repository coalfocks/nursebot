import { describe, expect, it } from 'vitest';
import { baselineReferenceLines, buildReadableTimeline, describeTimelineEvent } from './readableTimeline';
import type { AssignmentTimelineEvent } from './assignmentEventManifest';

const event = (overrides: Partial<AssignmentTimelineEvent> & Pick<AssignmentTimelineEvent, 'event_id' | 'event_type'>): AssignmentTimelineEvent => ({
  occurred_at: '2026-05-06T16:57:00Z',
  timezone: 'UTC',
  ...overrides,
});

const captured = {
  captured_at: '2026-05-06T16:50:00Z',
  baseline_version: 'room-203-baseline-v10',
  medications: [{ name: 'Dexamethasone', dose: '6 mg', route: 'PO', frequency: 'daily', indication: 'COVID pneumonia', status: 'active', kind: 'scheduled' }],
  active_orders: [{ name: 'Acetaminophen', dose: '650 mg', route: 'PO', frequency: 'q6h PRN', indication: 'fever', status: 'active', kind: 'prn' }],
};

describe('baseline reference block', () => {
  it('shows unavailable for an attempt with no verified snapshot, never the current chart', () => {
    const lines = baselineReferenceLines(null);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('unavailable');
    expect(lines.join(' ')).not.toContain('Dexamethasone');
  });

  it('reports a read error as unavailable rather than as confirmed absence', () => {
    expect(baselineReferenceLines(null, 'permission denied')[0]).toContain('could not be read');
  });

  it('shows the verified medications and active orders with their status, dose, and kind', () => {
    const lines = baselineReferenceLines(captured);
    expect(lines.join('\n')).toContain('Dexamethasone, 6 mg PO, daily (for COVID pneumonia) [active, scheduled]');
    expect(lines.join('\n')).toContain('Acetaminophen, 650 mg PO, q6h PRN (for fever) [active, prn]');
  });
});

describe('readable timeline entries', () => {
  it('keeps a bedside visit as its own entry, not a hint', () => {
    const entry = describeTimelineEvent(event({ event_id: 'bedside:1', event_type: 'bedside_action', channel: 'bedside', actor: { role: 'student' } }));
    expect(entry.category).toBe('bedside');
    expect(entry.heading).toContain('Went to bedside');
    expect(entry.actor).toBe('Learner');
  });

  it('keeps a hint click separate and labels it as not a bedside visit', () => {
    const entry = describeTimelineEvent(event({ event_id: 'hint:1', event_type: 'hint_shown', channel: 'hint', content: { text: 'Oxygen hint' } }));
    expect(entry.category).toBe('hint');
    expect(entry.heading).toBe('Hint opened (not a bedside visit)');
    expect(entry.heading).not.toContain('Went to bedside');
  });

  it('shows full order contents: name, priority, dose, route, frequency, and instructions', () => {
    const entry = describeTimelineEvent(event({
      event_id: 'order:1',
      event_type: 'order_placed',
      channel: 'orders',
      actor: { role: 'unknown' },
      content: { name: 'Lorazepam', priority: 'STAT', dose: '2 mg', route: 'IV', frequency: 'q1h PRN', instructions: 'For CIWA score above 15' },
    }));
    expect(entry.heading).toBe('Order: Lorazepam');
    expect(entry.details).toEqual(expect.arrayContaining(['Priority: STAT', 'Dose: 2 mg', 'Route: IV', 'Frequency: q1h PRN', 'Instructions: For CIWA score above 15']));
    expect(entry.actor).toBe('Actor not recorded');
  });

  it('interleaves messages, bedside visits, hints, and orders in timestamp order, with untimed events last', () => {
    const timeline = buildReadableTimeline([
      event({ event_id: 'order:late', event_type: 'order_placed', occurred_at: '2026-05-06T17:10:00Z', content: { name: 'EKG' } }),
      event({ event_id: 'untimed', event_type: 'nurse_message', occurred_at: null, content: { text: 'Note' } }),
      event({ event_id: 'msg:1', event_type: 'student_message', occurred_at: '2026-05-06T16:56:28Z', actor: { role: 'student' }, content: { text: 'Please get a stat ABG.' } }),
      event({ event_id: 'hint:1', event_type: 'hint_shown', occurred_at: '2026-05-06T16:57:00Z', content: { text: 'Hint' } }),
      event({ event_id: 'bedside:1', event_type: 'bedside_action', channel: 'bedside', occurred_at: '2026-05-06T16:58:00Z', actor: { role: 'student' } }),
    ]);
    expect(timeline.map((entry) => entry.eventId)).toEqual(['msg:1', 'hint:1', 'bedside:1', 'order:late', 'untimed']);
    expect(timeline.map((entry) => entry.category)).toEqual(['message', 'hint', 'bedside', 'order', 'message']);
  });
});
