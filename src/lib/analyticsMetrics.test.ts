import { describe, expect, it } from 'vitest';
import { computeCohortMetrics, computeDashboardMetrics, formatCompletionDuration, type AnalyticsRow } from './analyticsMetrics';

describe('formatCompletionDuration', () => {
  it('formats minutes and larger durations responsively', () => {
    expect(formatCompletionDuration(45)).toBe('45 min');
    expect(formatCompletionDuration(90)).toBe('1 hr 30 min');
    expect(formatCompletionDuration(125)).toBe('2 hr 5 min');
  });
});

const assignment = (overrides: Partial<Parameters<typeof computeCohortMetrics>[0][number]> = {}) => ({
  status: 'completed',
  feedbackStatus: 'completed',
  studentId: 'student-a',
  communicationScore: 4,
  mdmScore: 3,
  overallScore: 4,
  ...overrides,
});

describe('computeCohortMetrics', () => {
  it('uses separate completion and assessment denominators', () => {
    const rows = [
      ...Array.from({ length: 80 }, (_, index) => assignment({ studentId: `student-${index % 20}` })),
      ...Array.from({ length: 10 }, (_, index) => assignment({ status: 'assigned', feedbackStatus: null, studentId: `student-${(index + 80) % 20}` })),
      ...Array.from({ length: 10 }, (_, index) => assignment({ status: 'in_progress', feedbackStatus: null, studentId: `student-${(index + 90) % 20}` })),
    ];

    const metrics = computeCohortMetrics(rows, 20);

    expect(metrics.completedAssignments).toBe(80);
    expect(metrics.assessedAssignments).toBe(80);
    expect(metrics.completionRate).toBe(80);
    expect(metrics.assessmentCoverageRate).toBe(100);
    expect(metrics.participationRate).toBe(100);
  });

  it('counts assessment coverage out of completed opportunities', () => {
    const metrics = computeCohortMetrics(
      [
        assignment({ studentId: 'a' }),
        assignment({ studentId: 'b', feedbackStatus: 'pending' }),
        assignment({ studentId: 'c', status: 'assigned', feedbackStatus: null }),
      ],
      3,
    );

    expect(metrics.completionRate).toBe(66.7);
    expect(metrics.assessmentCoverageRate).toBe(50);
    expect(metrics.pendingReviews).toBe(1);
  });

  it('does not turn unavailable scores into zeroes', () => {
    const metrics = computeCohortMetrics(
      [assignment({ communicationScore: null, mdmScore: null })],
      1,
    );

    expect(metrics.assessedAssignments).toBe(1);
    expect(metrics.scoreDistributions.communication).toEqual({});
    expect(metrics.scoreDistributions.mdm).toEqual({});
  });

  it('deduplicates participation by learner and ignores cancelled assignments', () => {
    const metrics = computeCohortMetrics(
      [
        assignment({ studentId: 'a', status: 'in_progress', feedbackStatus: null }),
        assignment({ studentId: 'a', status: 'completed' }),
        assignment({ studentId: 'b', status: 'cancelled', feedbackStatus: null }),
      ],
      2,
    );

    expect(metrics.eligibleAssignments).toBe(2);
    expect(metrics.participatingLearners).toBe(1);
    expect(metrics.participationRate).toBe(50);
  });
});

describe('computeDashboardMetrics', () => {
  it('keeps missing scores out of denominators and creates observable trend/case rows', () => {
    const rows = [
      { ...assignment(), id: '1', schoolId: 's', studentName: 'A', studentRole: 'student', roomId: 1, roomNumber: '101', specialty: 'Medicine', createdAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-01T11:00:00Z', feedbackGeneratedAt: null, caseDifficulty: null, communicationBreakdown: null, mdmBreakdown: null },
      { ...assignment({ status: 'in_progress', communicationScore: null, mdmScore: null }), id: '2', schoolId: 's', studentName: 'B', studentRole: 'student', roomId: 2, roomNumber: '102', specialty: 'Surgery', createdAt: '2026-10-02T10:00:00Z', completedAt: null, feedbackGeneratedAt: null, caseDifficulty: null, communicationBreakdown: null, mdmBreakdown: null },
    ] as AnalyticsRow[];
    const metrics = computeDashboardMetrics(rows, 2);
    expect(metrics.eligibleAssignments).toBe(2);
    expect(metrics.completionTimeSampleSize).toBe(1);
    expect(metrics.trend).toHaveLength(2);
    expect(metrics.domainPerformance[0].scored).toBe(1);
    expect(metrics.caseHeatmap).toHaveLength(2);
  });
});
