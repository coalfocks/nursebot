import { describe, expect, it } from 'vitest';
import { isAssignmentWindowOpen } from './assignmentWindow';

describe('assignment activation windows', () => {
  const now = new Date('2026-10-16T18:00:00.000Z');

  it('blocks a scheduled assignment before its window', () => {
    expect(isAssignmentWindowOpen({ window_start: '2026-10-16T18:01:00.000Z' }, now)).toBe(false);
  });

  it('allows scheduled assignments at or after their window', () => {
    expect(isAssignmentWindowOpen({ window_start: '2026-10-16T18:00:00.000Z' }, now)).toBe(true);
    expect(isAssignmentWindowOpen({ window_start: '2026-10-16T17:59:00.000Z' }, now)).toBe(true);
  });

  it('preserves the authorized sandbox bypass', () => {
    expect(isAssignmentWindowOpen({ is_sandbox: true, window_start: '2026-10-16T19:00:00.000Z' }, now)).toBe(true);
  });
});
