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

  it('never exposes calendar dates or clock times for simulation history', () => {
    const label = formatScenarioPrior('2026-10-13T11:00:00.000Z', '2026-10-13T12:00:00.000Z');
    expect(label).toBe('Prior to encounter');
    expect(label).not.toMatch(/\d{4}/);
  });

  it('renders sentinel and nonsensically distant timestamps without enormous hour counts', () => {
    expect(formatScenarioPrior('2000-01-01T00:00:00.000Z', '2026-10-13T12:00:00.000Z')).toBe('Prior to encounter');
    expect(formatScenarioPrior('1900-01-01T00:00:00.000Z', '2026-10-13T12:00:00.000Z')).toBe('Prior to encounter');
    expect(clampToMinimumPrior('2000-01-01T00:00:00.000Z', '2026-10-13T12:00:00.000Z')).toBe('2000-01-01T00:00:00.000Z');
  });

  it('uses stable relative labels for baseline and post-page samples', () => {
    const baseline = formatScopedEmrTimestamp('2026-10-16T03:19:00.000Z', 'baseline', '2026-10-16T15:19:00.000Z');
    const assignment = formatScopedEmrTimestamp('2026-10-16T18:41:00.000Z', 'assignment', '2026-10-16T15:19:00.000Z');
    expect(baseline).toBe('Prior to encounter');
    expect(assignment).toBe('+202 min');
    expect(assignment).not.toMatch(/\d{4}|:/);
  });

  it('falls back without inventing an offset when the encounter anchor is absent', () => {
    expect(formatScopedEmrTimestamp('2026-10-16T18:41:00.000Z', 'assignment')).toBe('During encounter');
    expect(formatScopedEmrTimestamp('2026-10-16T18:41:00.000Z', 'baseline')).toBe('Prior to encounter');
  });
});
