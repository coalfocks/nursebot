import { describe, expect, it } from 'vitest';
import { sortConsultantMessages } from './consultantPortalModel';

describe('consultant message ordering', () => {
  it('renders each stored request before its response when timestamps tie', () => {
    const messages = sortConsultantMessages([
      { id: 'response', role: 'consultant', content: 'answer', audience: 'adult', specialty: 'neurology', created_at: '2026-10-19T05:00:00Z', request_receipt_at: '2026-10-19T05:00:00Z', message_sequence: 2 },
      { id: 'request', role: 'student', content: 'question', audience: 'adult', specialty: 'neurology', created_at: '2026-10-19T05:00:00Z', request_receipt_at: '2026-10-19T05:00:00Z', message_sequence: 1 },
    ]);
    expect(messages.map((message) => message.id)).toEqual(['request', 'response']);
  });

  it('keeps multiple request pairs in receipt order', () => {
    const messages = sortConsultantMessages([
      { id: 'r2-response', role: 'consultant', content: 'a2', audience: 'adult', specialty: 'neurology', created_at: '2026-10-19T05:00:00Z', request_receipt_at: '2026-10-19T05:01:00Z', message_sequence: 2 },
      { id: 'r1-request', role: 'student', content: 'q1', audience: 'adult', specialty: 'neurology', created_at: '2026-10-19T05:00:00Z', request_receipt_at: '2026-10-19T05:00:00Z', message_sequence: 1 },
      { id: 'r2-request', role: 'student', content: 'q2', audience: 'adult', specialty: 'neurology', created_at: '2026-10-19T05:00:00Z', request_receipt_at: '2026-10-19T05:01:00Z', message_sequence: 1 },
      { id: 'r1-response', role: 'consultant', content: 'a1', audience: 'adult', specialty: 'neurology', created_at: '2026-10-19T05:00:00Z', request_receipt_at: '2026-10-19T05:00:00Z', message_sequence: 2 },
    ]);
    expect(messages.map((message) => message.id)).toEqual(['r1-request', 'r1-response', 'r2-request', 'r2-response']);
  });
});
