import { describe, expect, it } from 'vitest';
import { computeCohortMetrics } from './analyticsMetrics';

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
