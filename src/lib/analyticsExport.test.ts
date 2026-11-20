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
    const samples = headers.indexOf('Timing samples (n)');
    expect(data[1][samples].value).toBe(1);
  });

  it('marks domain components with no structured subscores as unavailable in the workbook', () => {
    const rows = [analyticsFixture(0, { communicationBreakdown: null, mdmBreakdown: null })];
    const found = buildAnalyticsWorkbook(rows, 'https://example.test', 'Synthetic scope').find((item) => item.sheet === 'Domain subscores');
    const data = found!.data as Array<Array<{ value: unknown }>>;
    expect(data[1][7].value).toBe(1);
    expect(String(data[1][8].value)).toMatch(/Components unavailable/);
  });
});
