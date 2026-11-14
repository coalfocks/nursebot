import { describe, expect, it } from 'vitest';
import { canonicalJson, computeFeedbackFingerprint, type FeedbackFingerprintInput } from './feedback-fingerprint';

const base = (overrides: Partial<FeedbackFingerprintInput> = {}): FeedbackFingerprintInput => ({
  attempt_id: 'attempt-1',
  scoring_start_at: '2026-11-14T10:00:00.000Z',
  evidence: [{ id: 'e1', kind: 'message', actor_role: 'student', timestamp: '2026-11-14T10:01:00.000Z' }],
  unordered_event_ids: [],
  coverage: { orders_results: 'available_empty', nurse_messages: 'available_with_events' },
  progress_note: 'Note text',
  case_key: { version: 'case-key-v2', goals: ['Assess'] },
  rubric_version: 'feedback-v5-2026-11-14',
  assessment_version: 'assessment-v4-2026-11-14',
  model: 'openai/gpt-5.6-sol',
  prompt_versions: { evaluation: 'feedback-v5-2026-11-14', commentary: 'attempt-specific-comments-v2' },
  config: { mdm_max_tokens: 6000 },
  ...overrides,
});

describe('feedback input fingerprint', () => {
  it('returns the same fingerprint for identical frozen inputs regardless of key order', async () => {
    const a = await computeFeedbackFingerprint(base());
    const reordered = { ...base(), coverage: { nurse_messages: 'available_with_events', orders_results: 'available_empty' } };
    expect(await computeFeedbackFingerprint(reordered as FeedbackFingerprintInput)).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when evidence, coverage, case key, rubric, or model changes', async () => {
    const a = await computeFeedbackFingerprint(base());
    expect(await computeFeedbackFingerprint(base({ evidence: [{ id: 'e2', kind: 'message' }] }))).not.toBe(a);
    expect(await computeFeedbackFingerprint(base({ coverage: { orders_results: 'unavailable' } }))).not.toBe(a);
    expect(await computeFeedbackFingerprint(base({ case_key: { version: 'case-key-v3', goals: ['Assess'] } }))).not.toBe(a);
    expect(await computeFeedbackFingerprint(base({ rubric_version: 'feedback-v6' }))).not.toBe(a);
    expect(await computeFeedbackFingerprint(base({ model: 'other-model' }))).not.toBe(a);
  });

  it('keeps an empty order source distinct from an unavailable one', async () => {
    const empty = await computeFeedbackFingerprint(base({ coverage: { orders_results: 'available_empty' } }));
    const unavailable = await computeFeedbackFingerprint(base({ coverage: { orders_results: 'unavailable' } }));
    expect(empty).not.toBe(unavailable);
  });

  it('canonicalJson sorts nested keys deterministically', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe('{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
  });
});
