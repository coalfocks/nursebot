import { describe, expect, it } from 'vitest';
import { clampToMinimumPrior, formatScenarioPrior, minimumPriorTimestamp } from './scenarioTime';

describe('scenario EMR timestamps', () => {
  it('places newly authored records exactly twelve hours before the encounter', () => {
    expect(minimumPriorTimestamp('2026-10-13T12:00:00.000Z')).toBe('2026-10-13T00:00:00.000Z');
  });

  it('preserves older authored dates and clamps current/future dates', () => {
    expect(clampToMinimumPrior('2026-10-10T12:00:00.000Z', '2026-10-13T12:00:00.000Z')).toBe('2026-10-10T12:00:00.000Z');
    expect(clampToMinimumPrior('2026-10-13T11:00:00.000Z', '2026-10-13T12:00:00.000Z')).toBe('2026-10-13T00:00:00.000Z');
  });

  it('shows the relative minimum and exact timestamp together', () => {
    expect(formatScenarioPrior('2026-10-13T11:00:00.000Z', '2026-10-13T12:00:00.000Z')).toContain('12h prior');
  });
});
