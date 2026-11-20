import { describe, expect, it } from 'vitest';
import { ANALYTICS_QUERY_CONTRACT, completionMinutesFor, computeCohortMetrics, computeDashboardMetrics, computeGroupedAnalytics, buildLearnerOverview, extractEvidenceBackedThemes, extractRecurringBehaviorThemes, extractRubricComponentThemes, formatCompletionDuration, safetyFlagFor, type AnalyticsRow, normalizeThemeMinimum, savedCommentsFor, DEFAULT_THEME_MINIMUM, THEME_MINIMUM_OPTIONS, CASE_TIMING_EXCLUSION_LABELS } from './analyticsMetrics';

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

  it('does not fan a whole-attempt documentation comment out under every skill; untagged comments are not attached to any component', () => {
    const themes = extractRubricComponentThemes([scored('a', 'one', 2), scored('b', 'two', 2), scored('c', 'three', 2)], 3);
    themes.forEach((theme) => {
      expect(JSON.stringify(theme)).not.toContain(DOC_COMMENT);
      expect(theme.taggedComments).toEqual([]);
      expect(theme.taggedLearners).toBe(0);
    });
  });

  it('files tagged comments under their own component as evidence only (known learners)', () => {
    const tagged = (id: string, studentId: string | null) => scored(id, studentId, 2, { feedbackDebrief: { strengths: [
      { text: DOC_COMMENT, skill_key: 'clinical_reasoning_documentation', evidence_event_ids: [`doc-${id}`] },
      { text: 'Untagged general praise', evidence_event_ids: [`g-${id}`] },
    ], improvements: [] } });
    const two = extractRubricComponentThemes([tagged('a', 'one'), tagged('b', 'two')], 3);
    expect(find(two, 'clinical_reasoning_documentation')).toMatchObject({ taggedLearners: 2 });
    const three = extractRubricComponentThemes([tagged('a', 'one'), tagged('b', 'two'), tagged('c', 'three')], 3);
    const doc = find(three, 'clinical_reasoning_documentation');
    expect(doc).toMatchObject({ taggedLearners: 3 });
    expect(doc).not.toHaveProperty('recurringTheme');
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
    expect(doc).toMatchObject({ taggedLearners: 0, suppressed: true });
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

const learnerRow = (id: string, studentId: string | null, debrief: Record<string, unknown>, extra: Partial<AnalyticsRow> = {}) => analyticsRow({ id, studentId, studentName: studentId ?? 'Unknown learner', feedbackDebrief: debrief, ...extra });
const c = (text: string, extra: Record<string, unknown> = {}) => ({ text, evidence_event_ids: ['ev'], ...extra });

describe('recurring themes need the same behavior and direction', () => {
  it('does not treat a broad component tag shared by unrelated comments as a recurring theme', () => {
    const tag = { skill_key: 'focused_information_gathering' };
    const rows = [
      learnerRow('a', 'one', { strengths: [c('Asked about allergies', tag)] }),
      learnerRow('b', 'two', { strengths: [c('Checked oxygen flow rate', tag)] }),
      learnerRow('c', 'three', { strengths: [c('Monitored urine output', tag)] }),
    ];
    const themes = extractRecurringBehaviorThemes(rows, 3);
    expect(themes.recurringStrengths).toEqual([]);
    expect(themes.recurringNeeds).toEqual([]);
    expect(themes.keyedComments).toBe(0);
    // They remain component evidence only.
    const focused = extractRubricComponentThemes(rows, 3).find((t) => t.key === 'focused_information_gathering')!;
    expect(focused.taggedComments.map((x) => x.text)).toEqual(['Asked about allergies', 'Checked oxygen flow rate', 'Monitored urine output']);
  });

  it('claims a recurring strength only when the same behavior key and direction reach the distinct known-learner threshold', () => {
    const key = (k: string) => ({ behavior_key: k });
    const rows = [
      learnerRow('a', 'one', { strengths: [c('x', key('asks_allergies'))] }),
      learnerRow('a2', 'one', { strengths: [c('x again', key('asks_allergies'))] }), // repeat attempt: counts once
      learnerRow('b', 'two', { strengths: [c('y', key('asks_allergies'))] }),
      learnerRow('n', null, { strengths: [c('z', key('asks_allergies'))] }), // unknown learner never counts
    ];
    expect(extractRecurringBehaviorThemes(rows, 3).recurringStrengths).toEqual([]);
    expect(extractRecurringBehaviorThemes(rows, 3).belowThreshold).toMatchObject([{ behaviorKey: 'asks_allergies', direction: 'strength', learners: 2 }]);
    const three = [...rows, learnerRow('c', 'three', { strengths: [c('w', key('asks_allergies'))] })];
    expect(extractRecurringBehaviorThemes(three, 3).recurringStrengths).toMatchObject([{ behaviorKey: 'asks_allergies', learners: 3 }]);
    expect(extractRecurringBehaviorThemes(three, 5).recurringStrengths).toEqual([]);
  });

  it('keeps positives and improvements separate and never merges unlike behavior keys', () => {
    const rows = [
      learnerRow('a', 'one', { strengths: [c('s', { behavior_key: 'closes_loop' })] }),
      learnerRow('b', 'two', { strengths: [c('s', { behavior_key: 'closes_loop' })] }),
      learnerRow('c', 'three', { improvements: [c('i', { behavior_key: 'closes_loop' })] }),
      learnerRow('d', 'four', { improvements: [c('i', { behavior_key: 'orders_labs' })] }),
    ];
    const themes = extractRecurringBehaviorThemes(rows, 3);
    expect(themes.recurringStrengths).toEqual([]);
    expect(themes.recurringNeeds).toEqual([]);
    const needs = extractRecurringBehaviorThemes([...rows, learnerRow('e', 'five', { improvements: [c('i', { behavior_key: 'closes_loop' })] }), learnerRow('f', 'six', { improvements: [c('i', { behavior_key: 'closes_loop' })] })], 3);
    expect(needs.recurringNeeds).toMatchObject([{ behaviorKey: 'closes_loop', direction: 'improvement', learners: 3 }]);
    expect(needs.recurringStrengths).toEqual([]);
  });

  it('reports no keyed comments when the generator emits none and ignores malformed keys', () => {
    const rows = ['a', 'b', 'c'].map((id) => learnerRow(id, id, { strengths: [c('Same sentence', { behavior_key: 'Not A Key!' })] }));
    expect(extractRecurringBehaviorThemes(rows, 3)).toMatchObject({ recurringStrengths: [], recurringNeeds: [], keyedComments: 0 });
  });
});

describe('selected learner overview', () => {
  it('builds strengths, next practice goals, date range and links from saved feedback only, labeled for one evaluation', () => {
    const row = learnerRow('a', 'one', { strengths: [c('Escalated promptly')], improvements: [{ title: 'Document reassessment', evidence_event_ids: ['e2'] }] }, { completedAt: '2026-10-03T10:20:00Z' });
    const overview = buildLearnerOverview([row]);
    expect(overview).toMatchObject({ evaluatedCases: 1, basedOnOneEvaluation: true, firstDate: '2026-10-03', lastDate: '2026-10-03' });
    expect(overview.strengths.map((x) => x.text)).toEqual(['Escalated promptly']);
    expect(overview.nextPractice.map((x) => x.text)).toEqual(['Document reassessment']);
    expect(overview.sources).toEqual([{ assignmentId: 'a', caseLabel: '101', at: '2026-10-03T10:20:00Z' }]);
  });

  it('keeps older untagged comments visible once as evaluation feedback, never under all six skills', () => {
    const rows = [
      learnerRow('a', 'one', { strengths: [c('Old untagged strength')], improvements: [{ text: 'No evidence tip' }] }, { completedAt: '2026-10-01T10:00:00Z' }),
      learnerRow('b', 'one', { strengths: [c('Tagged', { skill_key: 'closed_loop_team_communication' })] }, { completedAt: '2026-10-05T10:00:00Z' }),
    ];
    const overview = buildLearnerOverview(rows);
    expect(overview).toMatchObject({ evaluatedCases: 2, basedOnOneEvaluation: false, firstDate: '2026-10-01', lastDate: '2026-10-05' });
    expect(overview.evaluationFeedback.map((x) => x.text)).toEqual(['Old untagged strength', 'No evidence tip']);
    expect(overview.unsupported.map((x) => x.text)).toEqual(['No evidence tip']);
    overview.components.forEach((component) => {
      const texts = component.taggedComments.map((x) => x.text);
      expect(texts).toEqual(component.key === 'closed_loop_team_communication' ? ['Tagged'] : []);
    });
  });

  it('applies no cohort minimum to a single learner and ignores unassessed attempts', () => {
    const overview = buildLearnerOverview([learnerRow('a', 'one', { strengths: [c('Only one')] }), learnerRow('p', 'one', { strengths: [c('Pending')] }, { feedbackStatus: 'pending' })]);
    expect(overview.evaluatedCases).toBe(1);
    expect(overview.strengths.map((x) => x.text)).toEqual(['Only one']);
  });
});

describe('per-case timing average, median, n and drill-through', () => {
  it('reports average and median with valid n and completed n, and keeps valid long durations', () => {
    const at = (id: string, start: string, end: string | null) => analyticsRow({ id, caseStartedAt: start, completedAt: end });
    const m = computeDashboardMetrics([
      at('a', '2026-10-03T10:00:00Z', '2026-10-03T10:10:00Z'),
      at('b', '2026-10-03T10:00:00Z', '2026-10-03T10:20:00Z'),
      at('c', '2026-10-03T10:00:00Z', '2026-10-04T10:00:00Z'), // 24h incl. pauses; valid and kept
      analyticsRow({ id: 'd', caseStartedAt: null, completedAt: '2026-10-03T10:20:00Z' }),
    ], 1);
    expect(m.caseTiming).toMatchObject({ validSamples: 3, completedAttempts: 4, medianMinutes: 20 });
    expect(m.caseTiming.averageMinutes).toBeCloseTo((10 + 20 + 1440) / 3, 1);
    expect(m.caseHeatmap[0]).toMatchObject({ completionTimeSampleSize: 3, completed: 4, medianCompletionMinutes: 20 });
    expect(m.caseHeatmap[0].averageCompletionMinutes).toBeCloseTo(490, 0);
    const d = m.caseTiming.attempts.find((x) => x.assignmentId === 'd')!;
    expect(d).toMatchObject({ start: null, complete: '2026-10-03T10:20:00Z', minutes: null, exclusion: 'start_not_recorded' });
    expect(d.exclusionReason).toMatch(/Case Start was not recorded/);
    expect(m.caseTiming.attempts.find((x) => x.assignmentId === 'c')).toMatchObject({ minutes: 1440, exclusionReason: null });
  });

  it('never substitutes created_at, first nurse message or feedback time for Start or Complete', () => {
    const row = analyticsRow({ id: 'x', caseStartedAt: null, createdAt: '2026-10-01T00:00:00Z', scoringStartAt: '2026-10-03T09:00:00Z', feedbackGeneratedAt: '2026-10-03T11:00:00Z', completedAt: '2026-10-03T10:00:00Z' });
    expect(completionMinutesFor(row)).toBeNull();
  });
});

describe('recurring-theme threshold is a selectable 3 or 5 distinct known learners', () => {
  it('offers exactly 3 or 5, defaults to 3, and normalizes anything else to 3', () => {
    expect([...THEME_MINIMUM_OPTIONS]).toEqual([3, 5]);
    expect(DEFAULT_THEME_MINIMUM).toBe(3);
    expect(normalizeThemeMinimum('5')).toBe(5);
    expect(normalizeThemeMinimum(5)).toBe(5);
    expect(normalizeThemeMinimum('3')).toBe(3);
    expect(normalizeThemeMinimum('4')).toBe(3);
    expect(normalizeThemeMinimum(undefined)).toBe(3);
  });

  it('a behavior shared by 3 distinct learners recurs at threshold 3 but not 5; 5 learners recur at both; repeat attempts count once; unknown learners never count', () => {
    const keyed = (id: string, learner: string | null) => learnerRow(id, learner, { strengths: [c('Asked about allergies', { behavior_key: 'asks_about_allergies' })] });
    const three = [keyed('a', 'l1'), keyed('b', 'l2'), keyed('c', 'l3'), keyed('d', 'l3'), keyed('u', null)];
    expect(extractRecurringBehaviorThemes(three, 3).recurringStrengths).toMatchObject([{ behaviorKey: 'asks_about_allergies', learners: 3 }]);
    expect(extractRecurringBehaviorThemes(three, 5).recurringStrengths).toEqual([]);
    const five = [...three, keyed('e', 'l4'), keyed('f', 'l5')];
    expect(extractRecurringBehaviorThemes(five, 3).recurringStrengths).toMatchObject([{ learners: 5 }]);
    expect(extractRecurringBehaviorThemes(five, 5).recurringStrengths).toMatchObject([{ learners: 5 }]);
  });

  it('individual learner summaries have no threshold: a single learner keeps all saved comments', () => {
    const overview = buildLearnerOverview([learnerRow('a', 'one', { strengths: [c('Only one')], improvements: [c('Only one improvement')] })]);
    expect(overview.strengths).toHaveLength(1);
    expect(overview.nextPractice).toHaveLength(1);
  });
});

describe('saved comment shapes: string arrays and legacy nurse_feedback', () => {
  const legacy = {
    clinical_reasoning: { strengths: ['Legacy clinical strength.', 'Shared legacy strength.'], areas_for_improvement: ['Legacy clinical improvement.'] },
    communication_skills: { strengths: ['Legacy communication strength.', 'shared  LEGACY strength.'], areas_for_improvement: ['Legacy communication improvement.'] },
  };

  it('accepts debrief strengths/improvements given as string arrays, labeled without linked event IDs', () => {
    const row = learnerRow('a', 'one', { strengths: ['You asked about oxygen.', 'You ordered an ABG.'], improvements: ['Reassess sooner.', 'Name the plan aloud.'] });
    const comments = savedCommentsFor(row);
    expect(comments.map((x) => [x.kind, x.text, x.evidenceIds, x.source])).toEqual([
      ['strength', 'You asked about oxygen.', [], 'debrief'], ['strength', 'You ordered an ABG.', [], 'debrief'],
      ['improvement', 'Reassess sooner.', [], 'debrief'], ['improvement', 'Name the plan aloud.', [], 'debrief'],
    ]);
    const overview = buildLearnerOverview([row]);
    expect(overview.strengths).toEqual([]);
    expect(overview.unsupported.map((x) => x.text)).toEqual(['You asked about oxygen.', 'You ordered an ABG.', 'Reassess sooner.', 'Name the plan aloud.']);
  });

  it('falls back to legacy nurse_feedback only when the canonical field is absent, without invented evidence or duplicate aliases', () => {
    const row = learnerRow('a', 'one', {}, { nurseFeedback: legacy });
    const comments = savedCommentsFor(row);
    expect(comments.every((x) => x.source === 'legacy_evaluation_feedback' && x.evidenceIds.length === 0 && x.behaviorKey === null && x.componentKeys.length === 0)).toBe(true);
    expect(comments.filter((x) => x.kind === 'strength').map((x) => x.text)).toEqual(['Legacy clinical strength.', 'Shared legacy strength.', 'Legacy communication strength.']);
    expect(comments.filter((x) => x.kind === 'improvement').map((x) => x.text)).toEqual(['Legacy clinical improvement.', 'Legacy communication improvement.']);
    const overview = buildLearnerOverview([row]);
    expect(overview.strengths).toEqual([]);
    expect(overview.unsupported).toHaveLength(5);
  });

  it('also reads the `communication` group name used by older writers', () => {
    const row = learnerRow('a', 'one', null as never, { feedbackDebrief: null, nurseFeedback: { communication: { strengths: ['Old comm strength.'], areas_for_improvement: ['Old comm improvement.'] } } });
    expect(savedCommentsFor(row).map((x) => x.text)).toEqual(['Old comm strength.', 'Old comm improvement.']);
  });

  it('does not use legacy when the canonical field is present, including a present-but-empty list, and never merges the two', () => {
    const canonical = savedCommentsFor(learnerRow('a', 'one', { strengths: [c('Canonical strength')], improvements: [c('Canonical improvement')] }, { nurseFeedback: legacy }));
    expect(canonical.map((x) => x.text)).toEqual(['Canonical strength', 'Canonical improvement']);
    const empty = savedCommentsFor(learnerRow('b', 'one', { strengths: [], improvements: [] }, { nurseFeedback: legacy }));
    expect(empty).toEqual([]);
    const mixed = savedCommentsFor(learnerRow('c', 'one', { strengths: [c('Canonical strength')] }, { nurseFeedback: legacy }));
    expect(mixed.filter((x) => x.kind === 'strength').map((x) => x.text)).toEqual(['Canonical strength']);
    expect(mixed.filter((x) => x.kind === 'improvement').every((x) => x.source === 'legacy_evaluation_feedback')).toBe(true);
  });
});

describe('timing is unavailable, never estimated, on a pre-migration database', () => {
  it('excludes every completed attempt with an explicit reason and reports no average', () => {
    const rows = [0, 1].map((i) => analyticsRow({ id: `p${i}`, caseStartedAt: null, caseStartUnavailable: true, completedAt: '2026-10-03T10:20:00Z', createdAt: '2026-10-03T10:00:00Z', scoringStartAt: '2026-10-03T10:05:00Z' }));
    const timing = computeDashboardMetrics(rows, 1).caseTiming;
    expect(timing).toMatchObject({ validSamples: 0, completedAttempts: 2, averageMinutes: null, medianMinutes: null });
    expect(timing.exclusions.schema_not_migrated).toBe(2);
    expect(timing.attempts.every((a) => a.minutes === null && a.exclusionReason === CASE_TIMING_EXCLUSION_LABELS.schema_not_migrated)).toBe(true);
    expect(completionMinutesFor(rows[0])).toBeNull();
  });
});
