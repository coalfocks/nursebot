// @vitest-environment node
import { it, expect } from 'vitest';
import writeXlsxFile from 'write-excel-file/node';
import { writeFileSync } from 'node:fs';
import { buildAnalyticsWorkbook } from './analyticsExport';
import { analyticsFixture } from '../test/analyticsFixture';

it('exports all filtered rows beyond the old 100-row cutoff, with separate cases and typed literal learner names', async () => {
  const rows = Array.from({ length: 125 }, (_, index) => analyticsFixture(index));
  rows[0] = analyticsFixture(0, { studentName: '=1+1', safetyResult: { level: 'critical', rationale: 'Synthetic contraindicated order' } });
  const sheets = buildAnalyticsWorkbook(rows, 'https://nursealthea.com', 'Synthetic test scope; test data only');
  expect(sheets.map((sheet) => sheet.sheet)).toEqual(['Case performance', 'Learner attempts', 'Domain subscores', 'Definitions']);
  expect(sheets[0].data).toHaveLength(3);
  expect(sheets[1].data).toHaveLength(126);
  expect(sheets[1].data[1][1]).toMatchObject({ type: String, value: '=1+1' });
  expect(sheets[1].data[125].at(-1)).toMatchObject({ value: 'https://nursealthea.com/assignment/synthetic-attempt-124' });
  expect(sheets[2].data).toHaveLength(7);
  const buffer = await writeXlsxFile(sheets).toBuffer();
  expect(buffer.subarray(0, 2).toString()).toBe('PK');
  if (process.env.ANALYTICS_QA_XLSX) writeFileSync(process.env.ANALYTICS_QA_XLSX, buffer);
});
