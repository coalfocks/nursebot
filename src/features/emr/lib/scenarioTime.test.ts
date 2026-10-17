import { describe, expect, it } from 'vitest';
import { clampToMinimumPrior, formatScenarioPrior, formatScopedEmrTimestamp, minimumPriorTimestamp } from './scenarioTime';

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

  it('renders sentinel and nonsensically distant timestamps without enormous hour counts', () => {
    expect(formatScenarioPrior('2000-01-01T00:00:00.000Z', '2026-10-13T12:00:00.000Z')).toBe('Prior to encounter');
    expect(formatScenarioPrior('1900-01-01T00:00:00.000Z', '2026-10-13T12:00:00.000Z')).toBe('Prior to encounter');
    expect(clampToMinimumPrior('2000-01-01T00:00:00.000Z', '2026-10-13T12:00:00.000Z')).toBe('2000-01-01T00:00:00.000Z');
  });

  it('keeps mixed baseline and assignment labels distinct after reload', () => {
    const baseline = formatScopedEmrTimestamp('2026-10-16T03:19:00.000Z', 'baseline', '2026-10-16T15:19:00.000Z');
    const assignment = formatScopedEmrTimestamp('2026-10-16T18:41:00.000Z', 'assignment', '2026-10-16T15:19:00.000Z');
    expect(baseline).toContain('12h prior');
    expect(assignment).not.toContain('prior');
    expect(assignment).toContain('2026');
  });
});
