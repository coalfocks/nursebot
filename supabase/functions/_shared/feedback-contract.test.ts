import { describe, expect, it } from 'vitest';
import { deriveScoringStart, isPostPageEvent } from './feedback-contract';

describe('feedback attempt provenance', () => {
  it('uses the first nurse page and excludes pre-page events', () => {
    const start = deriveScoringStart([
      { id: 'page', role: 'assistant', content: 'Please assess the patient.', created_at: '2026-01-01T01:00:00Z' },
      { id: 'student', role: 'student', content: 'I am at bedside.', created_at: '2026-01-01T01:01:00Z' },
    ]);
    expect(start?.event_id).toBe('page');
    expect(isPostPageEvent('2026-01-01T00:30:00Z', start?.scoring_start_at ?? null)).toBe(false);
  });

  it('marks an attempt without a first page as incomplete', () => {
    expect(deriveScoringStart([{ id: 'student', role: 'student', content: 'hello', created_at: '2026-01-01T01:00:00Z' }])).toBeNull();
  });
});
