import { describe, expect, it } from 'vitest';
import { decideExistingPatientChatRequest } from './patient-chat-request-claim';

const now = '2026-10-14T18:00:00.000Z';

describe('patient chat request claim decisions', () => {
  it('replays a completed request regardless of its old lease', () => {
    expect(decideExistingPatientChatRequest({
      status: 'completed',
      lease_expires_at: '2026-10-14T17:59:00.000Z',
    }, now)).toBe('completed');
  });

  it('leaves a pending request with an active lease to its current owner', () => {
    expect(decideExistingPatientChatRequest({
      status: 'pending',
      lease_expires_at: '2026-10-14T18:01:00.000Z',
    }, now)).toBe('processing');
  });

  it.each([
    { status: 'pending' as const, lease_expires_at: now },
    { status: 'pending' as const, lease_expires_at: '2026-10-14T17:59:00.000Z' },
    { status: 'pending' as const, lease_expires_at: null },
    { status: 'failed' as const, lease_expires_at: null },
  ])('selects the reclaim path for an available request: %o', (request) => {
    expect(decideExistingPatientChatRequest(request, now)).toBe('reclaim');
  });
});
