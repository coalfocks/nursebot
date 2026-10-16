import { describe, expect, it } from 'vitest';
import { ANALYTICS_QUERY_CONTRACT, buildAnalyticsCsv, computeCohortMetrics, computeDashboardMetrics, computeGroupedAnalytics, extractEvidenceBackedThemes, formatCompletionDuration, selectAssessedRows, SYNTHETIC_ANALYTICS_FIXTURE, type AnalyticsRow } from './analyticsMetrics';

describe('formatCompletionDuration', () => {
  it('formats minutes and larger durations responsively', () => {
    expect(formatCompletionDuration(45)).toBe('45 min');
    expect(formatCompletionDuration(90)).toBe('1 hr 30 min');
    expect(formatCompletionDuration(125)).toBe('2 hr 5 min');
  });
});

describe('analytics query contract', () => {
  it('defines assignment, completion, assessment, and score sample grain explicitly', () => {
    expect(ANALYTICS_QUERY_CONTRACT.rowGrain).toBe('one row per assignment id');
    expect(ANALYTICS_QUERY_CONTRACT.officialFilter).toBe('is_sandbox = false');
    expect(ANALYTICS_QUERY_CONTRACT.scoreSamples).toContain('distinct assignment id');
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

  it('uses one assignment row per denominator and only assessed rows for score distributions', () => {
    const metrics = computeCohortMetrics([
      assignment({ id: 'a', feedbackStatus: 'completed' }),
      assignment({ id: 'a', feedbackStatus: 'pending', communicationScore: 5 }),
      assignment({ id: 'b', feedbackStatus: 'pending', communicationScore: 5 }),
    ], 2);

    expect(metrics.eligibleAssignments).toBe(2);
    expect(metrics.assessedAssignments).toBe(1);
    expect(metrics.scoreDistributions.communication).toEqual({ '4': 1 });
  });
});

const analyticsRow = (overrides: Partial<AnalyticsRow> = {}): AnalyticsRow => ({
  id: 'a', schoolId: 's', schoolName: 'School', studentId: 'learner', studentName: 'Learner', studentRole: 'student', roomId: 1, roomNumber: '101', specialty: 'Medicine',
  status: 'completed', feedbackStatus: 'completed', communicationScore: 4, mdmScore: 3, overallScore: 3.5, createdAt: null, completedAt: null, feedbackGeneratedAt: null, caseDifficulty: null, communicationBreakdown: null, mdmBreakdown: null, nurseFeedback: null, feedbackDebrief: null,
  ...overrides,
});

describe('grouped analytics and evidence-backed themes', () => {
  it('does not inflate score samples with duplicate or unassessed rubric rows', () => {
    const groups = computeGroupedAnalytics([
      analyticsRow(),
      analyticsRow({ id: 'a', communicationScore: 5 }),
      analyticsRow({ id: 'b', feedbackStatus: 'pending', communicationScore: 5, mdmScore: 5 }),
    ], 'specialty');
    const medicine = groups.get('Medicine');
    expect(medicine).toMatchObject({ attempts: 2, completed: 2, assessed: 1, communication: [4], mdm: [3] });
  });

  it('requires evidence IDs, removes generic narratives, and counts themes by scope', () => {
    const themes = extractEvidenceBackedThemes([
      analyticsRow({ id: 'a', feedbackDebrief: { strengths: [{ text: 'Focused escalation', evidence_event_ids: ['message-a'] }], growth_areas: [{ title: 'Reassess after the order', evidence: [{ event_id: 'order-a' }] }] } }),
      analyticsRow({ id: 'b', feedbackDebrief: { strengths: [{ text: 'Focused escalation', evidence_event_ids: ['message-b'] }, { text: 'Observed a learner-authored interaction.', evidence_event_ids: ['message-b'] }], growth_areas: [{ title: 'Reassess after the order', evidence_event_ids: ['order-b'] }] } }),
      analyticsRow({ id: 'c', feedbackDebrief: { strengths: [{ text: 'Uncited claim' }], growth_areas: [{ title: 'Uncited growth' }] } }),
    ]);
    expect(themes.strengths).toEqual([{ text: 'Focused escalation', count: 2 }]);
    expect(themes.growth).toEqual([{ text: 'Reassess after the order', count: 2 }]);
  });
});

describe('computeDashboardMetrics', () => {
  it('keeps missing scores out of denominators and creates observable trend/case rows', () => {
    const rows = [
      { ...assignment(), id: '1', schoolId: 's', studentName: 'A', studentRole: 'student', roomId: 1, roomNumber: '101', specialty: 'Medicine', createdAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-01T11:00:00Z', feedbackGeneratedAt: null, caseDifficulty: null, communicationBreakdown: null, mdmBreakdown: null, nurseFeedback: null },
      { ...assignment({ status: 'in_progress', communicationScore: null, mdmScore: null }), id: '2', schoolId: 's', studentName: 'B', studentRole: 'student', roomId: 2, roomNumber: '102', specialty: 'Surgery', createdAt: '2026-10-02T10:00:00Z', completedAt: null, feedbackGeneratedAt: null, caseDifficulty: null, communicationBreakdown: null, mdmBreakdown: null, nurseFeedback: null },
    ] as AnalyticsRow[];
    const metrics = computeDashboardMetrics(rows, 2);
    expect(metrics.eligibleAssignments).toBe(2);
    expect(metrics.completionTimeSampleSize).toBe(1);
    expect(metrics.trend).toHaveLength(2);
    expect(metrics.domainPerformance[0].scored).toBe(1);
    expect(metrics.caseHeatmap).toHaveLength(2);
  });

  it('uses the unique assessed assignment set for domain samples and themes', () => {
    const rows = [
      { ...assignment({ id: 'assessed', communicationScore: 4, mdmScore: 3 }), id: 'assessed', schoolId: 's', studentName: 'A', studentRole: 'student', roomId: 1, roomNumber: '101', specialty: 'Medicine', createdAt: null, completedAt: null, feedbackGeneratedAt: null, caseDifficulty: null, communicationBreakdown: null, mdmBreakdown: null, nurseFeedback: null, feedbackDebrief: { strengths: [{ text: 'Cited strength', evidence_event_ids: ['event-1'] }] } },
      { ...assignment({ id: 'pending', feedbackStatus: 'pending', communicationScore: 5, mdmScore: 5 }), id: 'pending', schoolId: 's', studentName: 'B', studentRole: 'student', roomId: 2, roomNumber: '102', specialty: 'Medicine', createdAt: null, completedAt: null, feedbackGeneratedAt: null, caseDifficulty: null, communicationBreakdown: null, mdmBreakdown: null, nurseFeedback: null, feedbackDebrief: { strengths: [{ text: 'Should not appear', evidence_event_ids: ['event-2'] }] } },
      { ...assignment({ id: 'progress', status: 'in_progress', feedbackStatus: null, communicationScore: null, mdmScore: null }), id: 'progress', schoolId: 's', studentName: 'C', studentRole: 'student', roomId: 3, roomNumber: '103', specialty: 'Medicine', createdAt: null, completedAt: null, feedbackGeneratedAt: null, caseDifficulty: null, communicationBreakdown: null, mdmBreakdown: null, nurseFeedback: null, feedbackDebrief: { strengths: [{ text: 'Should not appear', evidence_event_ids: ['event-3'] }] } },
      { ...assignment({ id: 'assessed', communicationScore: 2 }), id: 'assessed', schoolId: 's', studentName: 'A duplicate', studentRole: 'student', roomId: 1, roomNumber: '101', specialty: 'Medicine', createdAt: null, completedAt: null, feedbackGeneratedAt: null, caseDifficulty: null, communicationBreakdown: null, mdmBreakdown: null, nurseFeedback: null, feedbackDebrief: null },
    ] as AnalyticsRow[];
    const metrics = computeDashboardMetrics(rows, 3);
    expect(selectAssessedRows(rows).map((row) => row.id)).toEqual(['assessed']);
    expect(metrics.domainPerformance.map((item) => item.scored)).toEqual([1, 1]);
    expect(extractEvidenceBackedThemes(selectAssessedRows(rows)).strengths).toEqual([{ text: 'Cited strength', count: 1 }]);
  });

  it('builds filtered CSV content from exactly the rows supplied', () => {
    const csv = buildAnalyticsCsv(SYNTHETIC_ANALYTICS_FIXTURE.slice(0, 2), false);
    expect(csv.split('\n')).toHaveLength(3);
    expect(csv).toContain('fixture-assignment-1');
    expect(csv).not.toContain('fixture-assignment-sandbox');
  });
});
