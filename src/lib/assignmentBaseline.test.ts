import { describe, expect, it } from 'vitest';
import { resolveAssignmentRoom } from './assignmentBaseline';

const room = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  room_number: '201',
  nurse_context: 'original nurse context',
  emr_context: '{"original":true}',
  updated_at: '2026-10-02T00:00:00Z',
  ...overrides,
});

describe('assignment scenario baselines', () => {
  it('keeps two assignments from the same room independent', () => {
    const first = resolveAssignmentRoom(room(), { nurse_context: 'first session' });
    const second = resolveAssignmentRoom(room(), { nurse_context: 'second session' });

    expect(first.nurse_context).toBe('first session');
    expect(second.nurse_context).toBe('second session');
  });

  it('does not let a later room revision change the pinned baseline', () => {
    const baseline = { nurse_context: 'before revision', emr_context: '{"version":1}' };
    const revisedRoom = room({ nurse_context: 'after revision', emr_context: '{"version":2}' });

    expect(resolveAssignmentRoom(revisedRoom, baseline)).toMatchObject(baseline);
  });

  it('falls back to the live room for legacy assignments', () => {
    expect(resolveAssignmentRoom(room({ nurse_context: 'legacy room' }), null).nurse_context).toBe('legacy room');
  });
});
