import { describe, expect, it } from 'vitest';
import { marScopeKey, sameMarScope } from './marScope';

const base = { patientId: 'p1', roomId: 7, assignmentId: 'a1', caseVersion: 'v1', actorId: 'actor-a' };

describe('MAR request scope identity', () => {
  it('fences assignment, patient, room, version, and actor changes', () => {
    expect(sameMarScope(base, { ...base })).toBe(true);
    expect(sameMarScope(base, { ...base, assignmentId: 'a2' })).toBe(false);
    expect(sameMarScope(base, { ...base, actorId: 'actor-b' })).toBe(false);
    expect(sameMarScope(base, { ...base, caseVersion: 'v2' })).toBe(false);
    expect(marScopeKey(base)).toContain('actor-a');
  });
});
