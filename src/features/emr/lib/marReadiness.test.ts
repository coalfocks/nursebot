import { describe, expect, it } from 'vitest';
import { learnerMarLoadState } from './marReadiness';

describe('learnerMarLoadState', () => {
  it('fails closed when an assignment has no immutable snapshot', () => {
    expect(learnerMarLoadState(null, true)).toMatchObject({ kind: 'missing_snapshot' });
  });

  it('does not treat a readiness failure as a missing snapshot', () => {
    expect(learnerMarLoadState('room-20-mar-v1', false)).toMatchObject({ kind: 'schema_unavailable' });
  });

  it('accepts a pinned case version only when the reader is ready', () => {
    expect(learnerMarLoadState(' room-20-mar-v1 ', true)).toEqual({ kind: 'ready', caseVersion: 'room-20-mar-v1' });
  });
});
