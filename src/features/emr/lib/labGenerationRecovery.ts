import type { MedicalOrder } from './types';

// Upper bound on the lab-results edge call. Without it, a call that never settles
// leaves the order in 'generating' forever (the deterministic fallback never runs).
export const LAB_GENERATION_TIMEOUT_MS = 45_000;

// A 'generating' order whose claim is older than this is treated as abandoned (the
// tab closed, the request hung before the timeout existed, or a status write was lost).
// It is longer than the timeout plus the local fallback and DB writes.
export const LAB_GENERATION_STALE_MS = 3 * 60_000;

export const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} did not finish within ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

type LabStateOrder = Pick<MedicalOrder, 'category' | 'labGenerationStatus' | 'labGenerationAttemptedAt'>;

export const isStaleLabGeneration = (order: LabStateOrder, nowMs: number): boolean => {
  if (order.category !== 'Lab' || order.labGenerationStatus !== 'generating') return false;
  const attemptedMs = order.labGenerationAttemptedAt ? Date.parse(order.labGenerationAttemptedAt) : Number.NaN;
  // No usable claim timestamp means nothing proves a generation is still running.
  if (!Number.isFinite(attemptedMs)) return true;
  return nowMs - attemptedMs >= LAB_GENERATION_STALE_MS;
};

// Orders that a student or instructor can re-run: a recorded failure, or an abandoned claim.
export const canRetryLabGeneration = (order: LabStateOrder, nowMs: number): boolean =>
  order.category === 'Lab' && (order.labGenerationStatus === 'failed' || isStaleLabGeneration(order, nowMs));
