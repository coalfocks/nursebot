import { describe, expect, it } from 'vitest';
import { isAssignmentWindowOpen } from './assignmentWindow';

describe('assignment activation window', () => {
  const now = new Date('2026-10-16T18:00:00.000Z');

  it('blocks scheduled non-sandbox assignments before their window', () => {
    expect(isAssignmentWindowOpen({ window_start: '2026-10-16T18:01:00.000Z' }, now)).toBe(false);
  });

  it('allows the window start and preserves the practice-room bypass', () => {
    expect(isAssignmentWindowOpen({ window_start: '2026-10-16T18:00:00.000Z' }, now)).toBe(true);
    expect(isAssignmentWindowOpen({ is_sandbox: true, window_start: '2099-01-01T00:00:00.000Z' }, now)).toBe(true);
  });
});
