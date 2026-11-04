import { describe, expect, it } from 'vitest';
import { eventContent, eventLabel, manifestToCsv, type AssignmentEventManifest } from './assignmentEventManifest';

const manifest: AssignmentEventManifest = {
  manifest_version: 1,
  assignment_id: 'assignment-1',
  generated_at: '2026-10-20T00:00:00.000Z',
  gaps: [],
  events: [{
    event_id: 'consult-request-1',
    event_type: 'consultant_request',
    actor: { role: 'student' },
    channel: 'consultant',
    service: { id: 'cardiology', label: 'Cardiology', audience: 'adult', urgency: 'routine' },
    occurred_at: '2026-10-19T23:00:00.000Z',
    timezone: 'UTC',
    elapsed_seconds: 120,
    sequence: null,
    ordering_ambiguous: true,
    content: { text: 'Please review the patient.' },
    links: { request_id: 'request-1', order_id: 'order-1' },
    provenance: { table: 'consultant_requests', row_id: 'request-1' },
  }],
};

describe('assignment event manifest exports', () => {
  it('preserves IDs, links, scope metadata, and ambiguous ordering in CSV', () => {
    const csv = manifestToCsv(manifest);
    expect(csv).toContain('consult-request-1');
    expect(csv).toContain('Cardiology');
    expect(csv).toContain('request-1');
    expect(csv).toContain('order-1');
    expect(csv).toContain('true');
  });

  it('labels same-time events as ambiguous without inventing a sequence', () => {
    expect(eventLabel(manifest.events[0])).toContain('same-time order ambiguous');
    expect(eventLabel(manifest.events[0])).toContain('Cardiology');
    expect(eventContent(manifest.events[0])).toBe('text: Please review the patient.');
  });
});
