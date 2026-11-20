import { describe, expect, it } from 'vitest';
import { savedCompletedAtFrom } from './completionTimestamp';

describe('savedCompletedAtFrom', () => {
  it('returns the server-stamped timestamp from the read-back, not a browser value', () => {
    expect(savedCompletedAtFrom({ completed_at: '2026-11-20T13:05:00.123456+00:00' })).toBe('2026-11-20T13:05:00.123456+00:00');
  });
  it('is unknown (null) when the read-back is missing or invalid, never an estimate', () => {
    expect(savedCompletedAtFrom(null)).toBeNull();
    expect(savedCompletedAtFrom({})).toBeNull();
    expect(savedCompletedAtFrom({ completed_at: null })).toBeNull();
    expect(savedCompletedAtFrom({ completed_at: 'not a date' })).toBeNull();
  });
});
