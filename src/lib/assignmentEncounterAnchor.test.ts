import { describe, expect, it } from 'vitest';
import { resolveAssignmentEncounterAnchor } from './assignmentEncounterAnchor';

describe('assignment encounter anchor', () => {
  it('uses each assignment first-page boundary independently in the same room', () => {
    expect(resolveAssignmentEncounterAnchor('2026-10-18T12:00:00.000Z')).toBe('2026-10-18T12:00:00.000Z');
    expect(resolveAssignmentEncounterAnchor('2026-10-19T12:00:00.000Z')).toBe('2026-10-19T12:00:00.000Z');
  });

  it('accepts canonical object/string baselines but not reusable room metadata', () => {
    expect(resolveAssignmentEncounterAnchor(null)).toBeNull();
    expect(resolveAssignmentEncounterAnchor({ encounterDate: '2026-10-18T12:00:00Z' })).toBeNull();
    expect(resolveAssignmentEncounterAnchor({ first_page_at: '2026-10-19T12:05:00Z' })).toBe('2026-10-19T12:05:00Z');
    expect(resolveAssignmentEncounterAnchor('not-a-date')).toBeNull();
  });
});
