import type { SheetData } from 'write-excel-file/browser';
import { ACTIVE_TIME_UNAVAILABLE_REASON, CASE_TIMING_EXCLUSION_LABELS, caseTimingFor, completionMinutesFor, computeDashboardMetrics, safetyFlagFor, SUBSCORE_DEFINITIONS, type AnalyticsRow } from './analyticsMetrics';

const timingStatus = (row: AnalyticsRow): string => {
  const timing = caseTimingFor(row);
  if (!timing) return 'Not completed';
  return 'minutes' in timing ? 'Valid' : CASE_TIMING_EXCLUSION_LABELS[timing.excluded];
};

type ExportSheet = { sheet: string; data: SheetData };
const table = (headers: string[], rows: unknown[][]): SheetData => [
  headers.map((value) => ({ value, fontWeight: 'bold' as const })),
  ...rows.map((row) => row.map((value) => typeof value === 'number' && Number.isFinite(value)
    ? { type: Number, value } : { type: String, value: value == null ? '' : String(value) })),
];

export function buildAnalyticsWorkbook(rows: AnalyticsRow[], origin: string, scope: string): ExportSheet[] {
  const uniqueRows = [...new Map(rows.map((row) => [row.id, row])).values()];
  const metrics = computeDashboardMetrics(uniqueRows, new Set(uniqueRows.map((row) => row.studentId)).size);
  return [
    { sheet: 'Case performance', data: table(['Case ID', 'Case', 'School', 'Specialty', 'Attempts', 'Completed', 'With feedback', 'Communication average (0-5)', 'Communication samples', 'Clinical Reasoning average (0-5)', 'Clinical Reasoning samples', 'Median minutes (Case Start to Complete)', 'Timing samples (n)'],
      metrics.caseHeatmap.map((row) => [row.roomId, row.caseLabel, row.schoolName, row.specialty, row.attempts, row.completed, row.assessed, row.communicationAverage, row.communicationSamples, row.reasoningAverage, row.reasoningSamples, row.medianCompletionMinutes, row.completionTimeSampleSize])) },
    { sheet: 'Learner attempts', data: table(['Assignment ID', 'Learner', 'School', 'Case ID', 'Case', 'Status', 'Feedback', 'Communication (0-5)', 'Clinical Reasoning (0-5)', ...SUBSCORE_DEFINITIONS.map((item) => `${item.label} (${item.min} to ${item.max})`), 'Case started at', 'First nurse page (scoring boundary)', 'Completed at', 'Elapsed minutes (wall-clock)', 'Timing status', 'Active minutes', 'Safety flag', 'Safety rationale', 'Assignment evidence link'], uniqueRows.map((row) => [
      row.id, row.studentName, row.schoolName, row.roomId, row.roomNumber, row.status, row.feedbackStatus, row.communicationScore, row.mdmScore,
      ...SUBSCORE_DEFINITIONS.map((item) => { const value = (item.domain === 'Communication' ? row.communicationBreakdown : row.mdmBreakdown)?.[item.key]; return value && typeof value === 'object' ? (value as Record<string, unknown>).score : value; }),
      row.caseStartedAt, row.scoringStartAt, row.completedAt, completionMinutesFor(row), timingStatus(row), 'Unavailable: no pause data', safetyFlagFor(row)?.level, safetyFlagFor(row)?.rationale, `${origin}/assignment/${encodeURIComponent(row.id)}`,
    ])) },
    { sheet: 'Domain subscores', data: table(['Domain', 'Component', 'Minimum', 'Maximum', 'Average', 'Scored attempts (n)', 'Assessed attempts', 'Unavailable attempts', 'Unavailable reason'], metrics.subscorePerformance.map((item) => [item.domain, item.label, item.min, item.max, item.average, item.scored, item.assessed, item.unavailable, item.unavailableReason ?? ''])) },
    { sheet: 'Definitions', data: table(['Item', 'Definition'], [
      ['Scope', scope], ['Exported at', new Date().toISOString()],
      ['Completed cases with feedback', 'Completed attempts whose saved feedback status is completed, divided by all completed attempts.'],
      ['Score samples', 'One distinct completed, assessed assignment per sample. Missing scores are excluded, not zero.'],
      ['Elapsed minutes (wall-clock)', 'Case Start (first opened) to Complete, same calculation as the dashboard. Wall-clock only: ' + ACTIVE_TIME_UNAVAILABLE_REASON + ' Attempts without a recorded Case Start, or with missing, invalid, or reversed timestamps, are excluded from averages and medians; see Timing status.'],
      ['Unavailable components', 'Components with no valid structured subscore are reported as unavailable, not zero, and are excluded from component averages.'],
      ['Cohort themes', 'Rubric-component themes are shown on the dashboard only and are not exported.'],
      ['Safety flags', 'Explicit saved concern/critical simulation assessment flags, not inferred real-world patient harm.'],
    ]) },
  ];
}

export async function downloadAnalyticsWorkbook(rows: AnalyticsRow[], scope: string) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  await writeXlsxFile(buildAnalyticsWorkbook(rows, window.location.origin, scope)).toFile(`nurse-althea-analytics-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
