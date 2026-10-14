import { describe, expect, it } from 'vitest';
import { assignmentStatusLabel, assignmentStatusTone } from './assignmentStatus';

describe('assignment status presentation', () => {
  it('keeps Bedside distinct from Completed', () => {
    expect(assignmentStatusLabel('bedside')).toBe('Bedside');
    expect(assignmentStatusTone('bedside')).toContain('blue');
    expect(assignmentStatusLabel('completed')).toBe('Completed');
  });

  it('shows the persisted status instead of silently defaulting it to Assigned', () => {
    expect(assignmentStatusLabel('cancelled')).toBe('Cancelled');
    expect(assignmentStatusLabel(null)).toBe('Unknown');
  });
});
