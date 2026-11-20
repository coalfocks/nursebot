import { describe, expect, it } from 'vitest';
import { buildAnalyticsWorkbook } from './analyticsExport';
import { analyticsFixture } from '../test/analyticsFixture';

const sheet = (name: string) => {
  const found = buildAnalyticsWorkbook([analyticsFixture(0), analyticsFixture(1, { caseStartedAt: null })], 'https://example.test', 'Synthetic scope').find((item) => item.sheet === name);
  if (!found) throw new Error(`missing sheet ${name}`);
  return found.data as Array<Array<{ value: unknown }>>;
};

describe('analytics Excel export timing', () => {
  it('uses the same Case Start to Complete calculation as the dashboard and labels exclusions', () => {
    const data = sheet('Learner attempts');
    const headers = data[0].map((cell) => cell.value);
    const elapsed = headers.indexOf('Elapsed minutes (Complete − Case Start)');
    const status = headers.indexOf('Timing status');
    expect(headers).not.toContain('Active minutes');
    expect(elapsed).toBeGreaterThan(-1);
    expect(data[1][elapsed].value).toBe(20);
    expect(data[1][status].value).toBe('Valid');
    expect(data[2][elapsed].value).toBe('');
    expect(String(data[2][status].value)).toMatch(/Case Start was not recorded/);
  });

  it('reports timing samples per case with n and median from the same calculation', () => {
    const data = sheet('Case performance');
    const headers = data[0].map((cell) => cell.value);
    expect(data[1][headers.indexOf('Valid timing n')].value).toBe(1);
    expect(data[1][headers.indexOf('Completed n')].value).toBe(1);
    expect(data[1][headers.indexOf('Average minutes (Start to Complete)')].value).toBe(20);
    expect(data[1][headers.indexOf('Median minutes (Start to Complete)')].value).toBe(20);
  });

  it('marks domain components with no structured subscores as unavailable in the workbook', () => {
    const rows = [analyticsFixture(0, { communicationBreakdown: null, mdmBreakdown: null })];
    const found = buildAnalyticsWorkbook(rows, 'https://example.test', 'Synthetic scope').find((item) => item.sheet === 'Domain subscores');
    const data = found!.data as Array<Array<{ value: unknown }>>;
    expect(data[1][7].value).toBe(1);
    expect(String(data[1][8].value)).toMatch(/Components unavailable/);
  });

  it('exports the same timing summary and per-attempt Start, Complete, duration and exclusion as the dashboard', () => {
    const summary = sheet('Timing summary').map((r) => [r[0].value, r[1].value]);
    expect(summary).toContainEqual(['Valid n', 1]);
    expect(summary).toContainEqual(['Completed n', 2]);
    const attempts = sheet('Timing by attempt');
    expect(attempts[0].map((cell) => cell.value)).toEqual(['Assignment ID', 'Learner', 'Case', 'Start (first case open)', 'Complete', 'Duration (minutes)', 'Exclusion reason']);
    const excluded = attempts.find((r) => r[0].value === 'synthetic-attempt-1')!;
    expect(excluded[3].value).toBe('');
    expect(String(excluded[6].value)).toMatch(/Case Start was not recorded/);
  });

  it('adds a Learner overview sheet only when the scope is one learner', () => {
    const one = buildAnalyticsWorkbook([analyticsFixture(0)], 'https://example.test', 's').find((x) => x.sheet === 'Learner overview');
    expect(one).toBeTruthy();
    const text = JSON.stringify(one!.data);
    expect(text).toContain('based on one evaluation');
    expect(text).toContain('https://example.test/assignment/synthetic-attempt-0/feedback');
    expect(buildAnalyticsWorkbook([analyticsFixture(0), analyticsFixture(1)], 'https://example.test', 's').some((x) => x.sheet === 'Learner overview')).toBe(false);
  });
});

describe('analytics Excel export start fields', () => {
  it('keeps "Start (first case open)" and "First nurse page (scoring boundary)" as separate labeled columns with their own values', () => {
    const data = sheet('Learner attempts');
    const headers = data[0].map((cell) => cell.value);
    const start = headers.indexOf('Start (first case open)');
    const page = headers.indexOf('First nurse page (scoring boundary)');
    expect(start).toBeGreaterThan(-1);
    expect(page).toBeGreaterThan(-1);
    expect(start).not.toBe(page);
    expect(data[1][start].value).toBe(analyticsFixture(0).caseStartedAt);
    expect(data[1][page].value).toBe(analyticsFixture(0).scoringStartAt);
  });
});
