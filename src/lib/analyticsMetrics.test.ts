import { describe, expect, it } from 'vitest';
import { ANALYTICS_QUERY_CONTRACT, completionMinutesFor, computeCohortMetrics, computeDashboardMetrics, computeGroupedAnalytics, extractEvidenceBackedThemes, extractRubricComponentThemes, formatCompletionDuration, safetyFlagFor, type AnalyticsRow } from './analyticsMetrics';

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
      analyticsRow({ id: 'a', studentId: 'learner-a', feedbackDebrief: { strengths: [{ text: 'Focused escalation', evidence_event_ids: ['message-a'] }], growth_areas: [{ title: 'Reassess after the order', evidence: [{ event_id: 'order-a' }] }] } }),
      analyticsRow({ id: 'b', studentId: 'learner-b', feedbackDebrief: { strengths: [{ text: 'Focused escalation', evidence_event_ids: ['message-b'] }, { text: 'Observed a learner-authored interaction.', evidence_event_ids: ['message-b'] }], growth_areas: [{ title: 'Reassess after the order', evidence_event_ids: ['order-b'] }] } }),
      analyticsRow({ id: 'c', feedbackDebrief: { strengths: [{ text: 'Uncited claim' }], growth_areas: [{ title: 'Uncited growth' }] } }),
    ], 1);
    expect(themes.strengths).toEqual([{ text: 'Focused escalation', count: 2 }]);
    expect(themes.growth).toEqual([{ text: 'Reassess after the order', count: 2 }]);
  });
});

describe('computeDashboardMetrics', () => {
  it('keeps missing scores out of denominators and creates observable trend/case rows', () => {
    const rows = [
      { ...assignment(), id: '1', schoolId: 's', studentName: 'A', studentRole: 'student', roomId: 1, roomNumber: '101', specialty: 'Medicine', createdAt: '2026-10-01T10:00:00Z', scoringStartAt: '2026-10-01T10:10:00Z', caseStartedAt: '2026-10-01T10:10:00Z', completedAt: '2026-10-01T11:00:00Z', feedbackGeneratedAt: null, caseDifficulty: null, communicationBreakdown: null, mdmBreakdown: null, nurseFeedback: null },
      { ...assignment({ status: 'in_progress', communicationScore: null, mdmScore: null }), id: '2', schoolId: 's', studentName: 'B', studentRole: 'student', roomId: 2, roomNumber: '102', specialty: 'Surgery', createdAt: '2026-10-02T10:00:00Z', completedAt: null, feedbackGeneratedAt: null, caseDifficulty: null, communicationBreakdown: null, mdmBreakdown: null, nurseFeedback: null },
    ] as AnalyticsRow[];
    const metrics = computeDashboardMetrics(rows, 2);
    expect(metrics.eligibleAssignments).toBe(2);
    expect(metrics.completionTimeSampleSize).toBe(1);
    expect(metrics.trend).toHaveLength(2);
    expect(metrics.domainPerformance[0].scored).toBe(1);
    expect(metrics.caseHeatmap).toHaveLength(2);
  });
});


describe('educator analytics regression coverage', () => {
  it('measures Case Start to Complete (not first nurse page or assignment wait) and excludes missing or invalid pairs with a reason', () => {
    const metrics = computeDashboardMetrics([
      analyticsRow({ id: 'valid', createdAt: '2026-10-01T00:00:00Z', scoringStartAt: '2026-10-03T09:00:00Z', caseStartedAt: '2026-10-03T10:00:00Z', completedAt: '2026-10-03T10:20:00Z' }),
      analyticsRow({ id: 'missing-start', createdAt: '2026-10-01T00:00:00Z', scoringStartAt: '2026-10-03T09:00:00Z', completedAt: '2026-10-03T10:20:00Z' }),
      analyticsRow({ id: 'reversed', caseStartedAt: '2026-10-03T11:00:00Z', completedAt: '2026-10-03T10:20:00Z' }),
      analyticsRow({ id: 'invalid', caseStartedAt: 'not-a-date', completedAt: '2026-10-03T10:20:00Z' }),
      analyticsRow({ id: 'no-complete', caseStartedAt: '2026-10-03T10:00:00Z', completedAt: null }),
    ], 1);
    expect(metrics.caseHeatmap[0]).toMatchObject({ medianCompletionMinutes: 20, completionTimeSampleSize: 1, completed: 5 });
    expect(metrics.caseTiming).toMatchObject({ validSamples: 1, completedAttempts: 5, exclusions: { start_not_recorded: 1, reversed_timestamps: 1, invalid_timestamp: 1, completion_not_recorded: 1 } });
  });

  it('elapsed time is Complete minus Case Start, including pauses, with no pause metric', () => {
    const metrics = computeDashboardMetrics([analyticsRow({ caseStartedAt: '2026-10-03T10:00:00Z', completedAt: '2026-10-03T10:30:00Z' })], 1);
    expect(metrics.caseTiming).not.toHaveProperty('activeTimeAvailable');
    expect(metrics.averageCompletionMinutes).toBe(30);
    expect(metrics.medianCompletionMinutes).toBe(30);
  });


  it('keeps timing averages to valid samples only, never counting missing starts as zero', () => {
    const metrics = computeDashboardMetrics([
      analyticsRow({ id: 'a', caseStartedAt: '2026-10-03T10:00:00Z', completedAt: '2026-10-03T10:10:00Z' }),
      analyticsRow({ id: 'b', caseStartedAt: '2026-10-03T10:00:00Z', completedAt: '2026-10-03T10:30:00Z' }),
      analyticsRow({ id: 'c', caseStartedAt: null, completedAt: '2026-10-03T10:30:00Z' }),
    ], 1);
    expect(metrics.averageCompletionMinutes).toBe(20);
    expect(metrics.completionTimeSampleSize).toBe(2);
  });

  it('does not let a feedback rerun change the Case Start-based duration', () => {
    const base = analyticsRow({ caseStartedAt: '2026-10-03T10:00:00Z', completedAt: '2026-10-03T10:20:00Z', scoringStartAt: '2026-10-03T09:00:00Z' });
    const rerun = { ...base, feedbackStatus: 'pending', feedbackGeneratedAt: '2026-10-04T08:00:00Z', scoringStartAt: '2026-10-04T08:00:00Z' };
    expect(completionMinutesFor(base)).toBe(20);
    expect(completionMinutesFor(rerun)).toBe(20);
  });

  it('keeps identical room numbers from different cases separate and deduplicates all samples', () => {
    const row = analyticsRow({ communicationBreakdown: { focused_information_gathering: { score: 2 }, efficiency_deduction: { score: 0 } }, mdmBreakdown: { safety_deduction: { score: 0 } } });
    const metrics = computeDashboardMetrics([row, row, analyticsRow({ id: 'other-case', roomId: 2, communicationScore: 2 }), analyticsRow({ id: 'pending', feedbackStatus: 'pending', communicationScore: 5 })], 1);
    expect(metrics.caseHeatmap).toHaveLength(2);
    expect(metrics.domainPerformance[0]).toMatchObject({ average: 3, scored: 2, eligible: 3 });
    expect(metrics.subscorePerformance.find((item) => item.label === 'Efficiency deduction')).toMatchObject({ average: 0, scored: 1 });
    expect(metrics.subscorePerformance.find((item) => item.label === 'Orders / monitoring quality')).toMatchObject({ average: null, scored: 0 });
  });

  it('applies cohort threshold to distinct learners, never repeated attempts or duplicate comments', () => {
    const theme = { text: 'Close the loop', evidence_event_ids: ['event'] };
    const row = (id: string, studentId: string) => analyticsRow({ id, studentId, feedbackDebrief: { strengths: [theme, theme], growth_areas: [theme], improvements: [theme] } });
    const two = [row('a','one'), row('b','one'), row('c','two')];
    expect(extractEvidenceBackedThemes(two).strengths).toEqual([]);
    expect(extractEvidenceBackedThemes([...two, row('d','three')]).strengths).toEqual([{ text: 'Close the loop', count: 3 }]);
    expect(extractEvidenceBackedThemes([...two, row('d','three')], 5).growth).toEqual([]);
    expect(extractEvidenceBackedThemes([row('a','one')], 1).growth).toEqual([{ text: 'Close the loop', count: 1 }]);
    expect(extractEvidenceBackedThemes([analyticsRow({ ...row('a','one'), feedbackStatus: 'failed' })], 1).strengths).toEqual([]);
  });

  it('uses explicit safety level, including legacy debrief safety, without inferring harm from text', () => {
    expect(safetyFlagFor(analyticsRow({ safetyResult: { level: 'critical', rationale: 'Contraindicated order', action: 'Unsafe order' } }))).toMatchObject({ level: 'critical', rationale: 'Contraindicated order' });
    expect(safetyFlagFor(analyticsRow({ feedbackDebrief: { safety_result: { level: 'concern' } } }))).toMatchObject({ level: 'concern' });
    expect(safetyFlagFor(analyticsRow({ safetyResult: { level: 'none', rationale: 'No harmful action' } }))).toBeNull();
  });
});

describe('unavailable structured subscores (domain totals only)', () => {
  it('reports components as unavailable with a reason, excludes them from component stats, and keeps domain totals', () => {
    const metrics = computeDashboardMetrics([
      analyticsRow({ id: 'structured', communicationScore: 4, communicationBreakdown: { focused_information_gathering: { score: 2 } } }),
      analyticsRow({ id: 'totals-only', studentId: 'learner-2', communicationScore: 5, communicationBreakdown: null, mdmBreakdown: null }),
    ], 2);
    const focused = metrics.subscorePerformance.find((item) => item.key === 'focused_information_gathering');
    expect(focused).toMatchObject({ average: 2, scored: 1, assessed: 2, unavailable: 1 });
    expect(focused?.unavailableReason).toMatch(/^Not estimated|Components unavailable|attempts have no valid structured score/);
    expect(metrics.domainPerformance[0]).toMatchObject({ domain: 'Communication', average: 4.5, scored: 2 });
  });

  it('marks every component unavailable with a whole-cohort reason when no structured subscores exist', () => {
    const metrics = computeDashboardMetrics([analyticsRow({ id: 'legacy', communicationBreakdown: null, mdmBreakdown: null })], 1);
    expect(metrics.subscorePerformance.every((item) => item.average === null && item.scored === 0 && item.unavailable === 1)).toBe(true);
    expect(metrics.subscorePerformance[0].unavailableReason).toMatch(/Components unavailable: no structured subscores/);
  });

  it('does not treat an out-of-range component score as a valid subscore', () => {
    const metrics = computeDashboardMetrics([analyticsRow({ communicationBreakdown: { focused_information_gathering: { score: 9 } } })], 1);
    expect(metrics.subscorePerformance[0]).toMatchObject({ scored: 0, unavailable: 1 });
  });
});

describe('cohort themes by rubric component', () => {
  const DOC_COMMENT = 'Documented a clear reasoning rationale for the plan.';
  const scored = (id: string, studentId: string | null, focused: number, extra: Partial<AnalyticsRow> = {}) => analyticsRow({
    id, studentId, studentName: studentId ?? 'Unknown learner',
    communicationBreakdown: { focused_information_gathering: { score: focused, feedback: `Focused explanation ${id}`, evidence_event_ids: [`focus-${id}`] } },
    mdmBreakdown: { clinical_reasoning_documentation: { score: 1, feedback: `Documentation explanation ${id}`, evidence_event_ids: [`doc-${id}`] } },
    feedbackDebrief: { strengths: [{ text: DOC_COMMENT, evidence_event_ids: [`doc-${id}`] }], improvements: [{ text: `Personal tip ${id}`, evidence_event_ids: [`e-${id}`] }] },
    ...extra,
  });
  const find = (themes: ReturnType<typeof extractRubricComponentThemes>, key: string) => themes.find((theme) => theme.key === key)!;

  it('counts distinct learners and shows each attempt its own component explanation and evidence only', () => {
    const themes = extractRubricComponentThemes([scored('a', 'one', 2), scored('b', 'two', 2), scored('c', 'three', 1)], 3);
    const focused = find(themes, 'focused_information_gathering');
    expect(focused).toMatchObject({ validLearners: 3, atMaxLearners: 2, belowMaxLearners: 1, suppressed: false, validAttempts: 3 });
    expect(focused.attempts.find((attempt) => attempt.assignmentId === 'a')).toMatchObject({ explanation: 'Focused explanation a', evidenceIds: ['focus-a'] });
    expect(JSON.stringify(focused.attempts)).not.toContain('Documentation explanation');
    expect(JSON.stringify(themes)).not.toContain('Personal tip');
  });

  it('does not fan a whole-attempt documentation comment out under every skill; untagged comments yield no recurring theme', () => {
    const themes = extractRubricComponentThemes([scored('a', 'one', 2), scored('b', 'two', 2), scored('c', 'three', 2)], 3);
    themes.forEach((theme) => {
      expect(JSON.stringify(theme)).not.toContain(DOC_COMMENT);
      expect(theme.taggedComments).toEqual([]);
      expect(theme.recurringTheme).toBe(false);
      expect(theme.taggedLearners).toBe(0);
    });
  });

  it('builds a recurring theme only from tagged comments with enough distinct known learners', () => {
    const tagged = (id: string, studentId: string | null) => scored(id, studentId, 2, { feedbackDebrief: { strengths: [
      { text: DOC_COMMENT, skill_key: 'clinical_reasoning_documentation', evidence_event_ids: [`doc-${id}`] },
      { text: 'Untagged general praise', evidence_event_ids: [`g-${id}`] },
    ], improvements: [] } });
    const two = extractRubricComponentThemes([tagged('a', 'one'), tagged('b', 'two')], 3);
    expect(find(two, 'clinical_reasoning_documentation')).toMatchObject({ taggedLearners: 2, recurringTheme: false });
    const three = extractRubricComponentThemes([tagged('a', 'one'), tagged('b', 'two'), tagged('c', 'three')], 3);
    const doc = find(three, 'clinical_reasoning_documentation');
    expect(doc).toMatchObject({ taggedLearners: 3, recurringTheme: true });
    expect(doc.taggedComments.every((comment) => comment.text === DOC_COMMENT && comment.evidenceIds.length > 0)).toBe(true);
    expect(find(three, 'focused_information_gathering').taggedComments).toEqual([]);
    expect(JSON.stringify(three)).not.toContain('Untagged general praise');
  });

  it('does not count three null-student rows toward a 3-learner threshold', () => {
    const themes = extractRubricComponentThemes([scored('a', null, 2), scored('b', null, 2), scored('c', null, 2)], 3);
    const focused = find(themes, 'focused_information_gathering');
    expect(focused).toMatchObject({ validLearners: 0, atMaxLearners: 0, unknownLearnerAttempts: 3, suppressed: true });
    const tagged = (id: string) => scored(id, null, 2, { feedbackDebrief: { strengths: [{ text: DOC_COMMENT, skill_key: 'clinical_reasoning_documentation', evidence_event_ids: ['e'] }], improvements: [] } });
    const doc = find(extractRubricComponentThemes([tagged('a'), tagged('b'), tagged('c')], 3), 'clinical_reasoning_documentation');
    expect(doc).toMatchObject({ taggedLearners: 0, recurringTheme: false, suppressed: true });
  });

  it('suppresses components below the learner minimum and counts repeated attempts once per learner', () => {
    const focused = find(extractRubricComponentThemes([scored('a', 'one', 2), scored('b', 'one', 2), scored('c', 'two', 2)], 3), 'focused_information_gathering');
    expect(focused).toMatchObject({ validLearners: 2, validAttempts: 3, suppressed: true });
  });

  it('excludes unassessed attempts and reports attempts lacking a component as unavailable', () => {
    const themes = extractRubricComponentThemes([scored('a', 'one', 2), scored('pending', 'two', 2, { feedbackStatus: 'pending' }), analyticsRow({ id: 'no-breakdown', studentId: 'three' })], 1);
    expect(find(themes, 'focused_information_gathering')).toMatchObject({ validLearners: 1, validAttempts: 1, unavailableAttempts: 1, suppressed: false });
  });
});
