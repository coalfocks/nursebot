import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAB_GENERATION_STALE_MS,
  canRetryLabGeneration,
  isStaleLabGeneration,
  withTimeout,
} from './labGenerationRecovery';

const NOW = Date.parse('2026-11-19T00:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const labOrder = (overrides: Partial<{ category: string; labGenerationStatus: string; labGenerationAttemptedAt: string | null }> = {}) => ({
  category: 'Lab',
  labGenerationStatus: 'generating',
  labGenerationAttemptedAt: at(0),
  ...overrides,
}) as Parameters<typeof isStaleLabGeneration>[0];

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves with the value when the promise settles in time', async () => {
    const result = withTimeout(Promise.resolve('labs'), 1000, 'Lab generation');
    await expect(result).resolves.toBe('labs');
  });

  it('propagates the original rejection when the promise fails before the deadline', async () => {
    const result = withTimeout(Promise.reject(new Error('boom')), 1000, 'Lab generation');
    await expect(result).rejects.toThrow('boom');
  });

  it('rejects with a labelled timeout when the promise never settles', async () => {
    const never = new Promise<never>(() => undefined);
    const result = withTimeout(never, 45_000, 'Lab generation');
    const assertion = expect(result).rejects.toThrow('Lab generation did not finish within 45s');
    await vi.advanceTimersByTimeAsync(45_000);
    await assertion;
  });
});

describe('isStaleLabGeneration', () => {
  it('is false for a fresh claim that may still be running', () => {
    expect(isStaleLabGeneration(labOrder({ labGenerationAttemptedAt: at(10_000) }), NOW)).toBe(false);
  });

  it('is true once the claim is older than the stale window', () => {
    expect(isStaleLabGeneration(labOrder({ labGenerationAttemptedAt: at(LAB_GENERATION_STALE_MS) }), NOW)).toBe(true);
    expect(isStaleLabGeneration(labOrder({ labGenerationAttemptedAt: at(LAB_GENERATION_STALE_MS + 1) }), NOW)).toBe(true);
  });

  it('treats a generating order with no usable timestamp as abandoned', () => {
    expect(isStaleLabGeneration(labOrder({ labGenerationAttemptedAt: null }), NOW)).toBe(true);
    expect(isStaleLabGeneration(labOrder({ labGenerationAttemptedAt: 'not-a-date' }), NOW)).toBe(true);
  });

  it('ignores orders that are not generating, and non-lab orders', () => {
    expect(isStaleLabGeneration(labOrder({ labGenerationStatus: 'completed', labGenerationAttemptedAt: at(999_999_999) }), NOW)).toBe(false);
    expect(isStaleLabGeneration(labOrder({ labGenerationStatus: 'not_started', labGenerationAttemptedAt: null }), NOW)).toBe(false);
    expect(isStaleLabGeneration(labOrder({ category: 'Medication', labGenerationAttemptedAt: at(999_999_999) }), NOW)).toBe(false);
  });
});

describe('canRetryLabGeneration', () => {
  it('allows retry for recorded failures and abandoned claims on lab orders', () => {
    expect(canRetryLabGeneration(labOrder({ labGenerationStatus: 'failed' }), NOW)).toBe(true);
    expect(canRetryLabGeneration(labOrder({ labGenerationAttemptedAt: at(LAB_GENERATION_STALE_MS + 60_000) }), NOW)).toBe(true);
  });

  it('does not offer retry for healthy, in-progress, or non-lab orders', () => {
    expect(canRetryLabGeneration(labOrder({ labGenerationStatus: 'completed' }), NOW)).toBe(false);
    expect(canRetryLabGeneration(labOrder({ labGenerationAttemptedAt: at(1000) }), NOW)).toBe(false);
    expect(canRetryLabGeneration(labOrder({ category: 'Imaging', labGenerationStatus: 'failed' }), NOW)).toBe(false);
  });
});
