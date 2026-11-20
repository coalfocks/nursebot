export type AnalyticsAssignment = {
  id?: string;
  status: string | null;
  feedbackStatus: string | null;
  studentId: string | null;
  communicationScore: number | null;
  mdmScore: number | null;
  overallScore: number | null;
  feedbackDebrief?: Record<string, unknown> | null;
};

export type AnalyticsRow = AnalyticsAssignment & {
  id: string;
  schoolId: string | null;
  schoolName?: string | null;
  studentName: string;
  studentRole: string | null;
  roomId: number;
  roomNumber: string;
  specialty: string;
  createdAt: string | null;
  scoringStartAt?: string | null;
  /** Case Start: when the learner first opened the case (assignment moved to in_progress). Null for attempts that pre-date start tracking. */
  caseStartedAt?: string | null;
  /** True when the database predates case_started_at: timing is unavailable for the row, never estimated. */
  caseStartUnavailable?: boolean;
  safetyResult?: Record<string, unknown> | null;
  completedAt: string | null;
  feedbackGeneratedAt: string | null;
  caseDifficulty: string | null;
  communicationBreakdown: Record<string, unknown> | null;
  mdmBreakdown: Record<string, unknown> | null;
  nurseFeedback: Record<string, unknown> | null;
  feedbackDebrief: Record<string, unknown> | null;
};

export type CaseTimingAttempt = {
  assignmentId: string; studentName: string; caseLabel: string;
  start: string | null; complete: string | null;
  /** Complete − Start in minutes (pauses included); null when excluded. */
  minutes: number | null; exclusion: CaseTimingExclusion | null; exclusionReason: string | null;
};

export type CaseTimingSummary = {
  /** Elapsed minutes = Complete − Case Start, including any pauses. */
  validSamples: number;
  completedAttempts: number;
  averageMinutes: number | null;
  medianMinutes: number | null;
  exclusions: Record<CaseTimingExclusion, number>;
  /** Drill-through: every completed attempt in scope with Start, Complete, duration and exclusion reason. */
  attempts: CaseTimingAttempt[];
};

export type DashboardMetrics = CohortMetrics & {
  medianCompletionMinutes: number | null;
  averageCompletionMinutes: number | null;
  completionTimeSampleSize: number;
  caseTiming: CaseTimingSummary;
  trend: Array<{ label: string; attempts: number; completed: number; assessed: number }>;
  domainPerformance: Array<{ domain: string; average: number | null; scored: number; eligible: number }>;
  caseHeatmap: CasePerformance[];
  subscorePerformance: SubscorePerformance[];
};

export type MetricDefinition = {
  metricId: string;
  name: string;
  unit: string;
  numerator: string;
  denominator: string;
  scoreSource: string;
};

export type CohortMetrics = {
  metricVersion: string;
  eligibleAssignments: number;
  completedAssignments: number;
  assessedAssignments: number;
  eligibleLearners: number;
  participatingLearners: number;
  pendingReviews: number;
  completionRate: number | null;
  assessmentCoverageRate: number | null;
  participationRate: number | null;
  scoreDistributions: {
    communication: Record<string, number>;
    mdm: Record<string, number>;
  };
};

export const ANALYTICS_METRIC_VERSION = '2026-11-11.1';

export const ANALYTICS_QUERY_CONTRACT = {
  source: 'student_room_assignments',
  rowGrain: 'one row per assignment id',
  officialFilter: 'is_sandbox = false',
  eligible: "status != 'cancelled'",
  completed: "status = 'completed'",
  assessed: "status = 'completed' AND feedback_status = 'completed'",
  scoreSamples: 'one distinct assignment id per domain, restricted to assessed rows with a finite score',
} as const;

export const formatCompletionDuration = (minutes: number | null): string => {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
};

export const COHORT_METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    metricId: 'completion_rate',
    name: 'Completion',
    unit: 'percent',
    numerator: 'completed opportunities',
    denominator: 'eligible assigned opportunities',
    scoreSource: 'assignment status',
  },
  {
    metricId: 'assessment_coverage',
    name: 'Completed cases with feedback',
    unit: 'percent',
    numerator: 'completed opportunities with saved feedback',
    denominator: 'completed opportunities',
    scoreSource: 'feedback status',
  },
  {
    metricId: 'participation_rate',
    name: 'Participation',
    unit: 'percent',
    numerator: 'eligible learners with a started encounter',
    denominator: 'eligible learners',
    scoreSource: 'assignment status',
  },
];

const uniqueByAssignmentId = <T extends AnalyticsAssignment>(assignments: T[]): T[] => {
  const seen = new Set<string>();
  return assignments.filter((assignment, index) => {
    const id = assignment.id ?? `row-${index}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const percentage = (numerator: number, denominator: number) =>
  denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : null;

const increment = (distribution: Record<string, number>, value: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return;
  const key = String(value);
  distribution[key] = (distribution[key] ?? 0) + 1;
};

export const computeCohortMetrics = (
  assignments: AnalyticsAssignment[],
  eligibleLearners: number,
): CohortMetrics => {
  const uniqueAssignments = uniqueByAssignmentId(assignments);
  const eligible = uniqueAssignments.filter((assignment) => assignment.status !== 'cancelled');
  const completed = eligible.filter((assignment) => assignment.status === 'completed');
  const assessed = completed.filter((assignment) => assignment.feedbackStatus === 'completed');
  const participatingLearners = new Set(
    eligible
      .filter((assignment) => assignment.status !== 'assigned')
      .map((assignment) => assignment.studentId)
      .filter((studentId): studentId is string => Boolean(studentId)),
  ).size;
  const pendingReviews = completed.filter((assignment) =>
    ['pending', 'processing', 'failed'].includes(assignment.feedbackStatus ?? ''),
  ).length;

  const communication: Record<string, number> = {};
  const mdm: Record<string, number> = {};
  assessed.forEach((assignment) => {
    increment(communication, assignment.communicationScore);
    increment(mdm, assignment.mdmScore);
  });

  return {
    metricVersion: ANALYTICS_METRIC_VERSION,
    eligibleAssignments: eligible.length,
    completedAssignments: completed.length,
    assessedAssignments: assessed.length,
    eligibleLearners,
    participatingLearners,
    pendingReviews,
    completionRate: percentage(completed.length, eligible.length),
    assessmentCoverageRate: percentage(assessed.length, completed.length),
    participationRate: percentage(participatingLearners, eligibleLearners),
    scoreDistributions: { communication, mdm },
  };
};

export type GroupedAnalytics = {
  attempts: number;
  completed: number;
  assessed: number;
  communication: number[];
  mdm: number[];
};

export const computeGroupedAnalytics = (
  rows: AnalyticsRow[],
  groupBy: 'school' | 'specialty',
): Map<string, GroupedAnalytics> => {
  const groups = new Map<string, GroupedAnalytics>();
  uniqueByAssignmentId(rows).forEach((row) => {
    const key = groupBy === 'school' ? row.schoolName ?? 'Unknown school' : row.specialty;
    const current = groups.get(key) ?? { attempts: 0, completed: 0, assessed: 0, communication: [], mdm: [] };
    current.attempts += 1;
    if (row.status === 'completed') current.completed += 1;
    const assessed = row.status === 'completed' && row.feedbackStatus === 'completed';
    if (assessed) {
      current.assessed += 1;
      if (typeof row.communicationScore === 'number' && Number.isFinite(row.communicationScore)) current.communication.push(row.communicationScore);
      if (typeof row.mdmScore === 'number' && Number.isFinite(row.mdmScore)) current.mdm.push(row.mdmScore);
    }
    groups.set(key, current);
  });
  return groups;
};

type Narrative = { text?: unknown; evidence_event_ids?: unknown; evidence?: unknown; title?: unknown; practice_example?: unknown; example?: unknown };
export type AnalyticsTheme = { text: string; count: number };

const narrativeEvidenceIds = (item: Narrative): string[] => {
  const direct = Array.isArray(item.evidence_event_ids) ? item.evidence_event_ids : [];
  const nested = Array.isArray(item.evidence) ? item.evidence : [];
  return [...direct, ...nested.map((e) => e && typeof e === 'object' ? (e as Record<string, unknown>).event_id ?? (e as Record<string, unknown>).id : null)]
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
};

const narrativeText = (item: Narrative, growth: boolean): string | null => {
  const value = growth ? (item.title ?? item.practice_example ?? item.example ?? item.text) : item.text;
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || /^observed (?:a )?learner-authored/i.test(text) || /^no case-specific/i.test(text)) return null;
  return text;
};

export const extractEvidenceBackedThemes = (rows: AnalyticsRow[], minimumLearners = 3): { strengths: AnalyticsTheme[]; growth: AnalyticsTheme[] } => {
  const supporters = new Map<AnalyticsTheme, Set<string>>();
  const collect = (target: Map<string, AnalyticsTheme>, values: unknown, growth: boolean, learnerId: string) => {
    if (!Array.isArray(values)) return;
    values.forEach((raw) => {
      if (!raw || typeof raw !== 'object') return;
      const item = raw as Narrative;
      const text = narrativeText(item, growth);
      if (!text || narrativeEvidenceIds(item).length === 0) return;
      const key = text.toLocaleLowerCase();
      const existing = target.get(key);
      const theme = existing ?? { text, count: 0 };
      if (!existing) target.set(key, theme);
      const learners = supporters.get(theme) ?? new Set<string>();
      learners.add(learnerId); supporters.set(theme, learners); theme.count = learners.size;
    });
  };
  const strengths = new Map<string, AnalyticsTheme>();
  const growth = new Map<string, AnalyticsTheme>();
  uniqueByAssignmentId(rows).filter(isAssessed).forEach((row) => {
    if (!row.studentId) return;
    const debrief = row.feedbackDebrief ?? {};
    collect(strengths, debrief.strengths, false, row.studentId);
    collect(growth, debrief.growth_areas, true, row.studentId);
    collect(growth, debrief.improvements, true, row.studentId);
  });
  return { strengths: [...strengths.values()].filter((item) => item.count >= minimumLearners).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)), growth: [...growth.values()].filter((item) => item.count >= minimumLearners).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)) };
};

const average = (values: number[]) =>
  values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(1));
};

export type CasePerformance = {
  roomId: number; caseLabel: string; schoolName: string; specialty: string;
  attempts: number; completed: number; assessed: number;
  communicationAverage: number | null; reasoningAverage: number | null;
  communicationSamples: number; reasoningSamples: number;
  medianCompletionMinutes: number | null; averageCompletionMinutes: number | null; completionTimeSampleSize: number;
};

export const isAssessed = (row: AnalyticsAssignment) => row.status === 'completed' && row.feedbackStatus === 'completed';

export type CaseTimingExclusion = 'schema_not_migrated' | 'start_not_recorded' | 'completion_not_recorded' | 'invalid_timestamp' | 'reversed_timestamps';

export const CASE_TIMING_EXCLUSION_LABELS: Record<CaseTimingExclusion, string> = {
  schema_not_migrated: 'Case Start timing is unavailable (database not yet migrated to record Case Start)',
  start_not_recorded: 'Case Start was not recorded (attempt began before start tracking)',
  completion_not_recorded: 'Completion timestamp is missing',
  invalid_timestamp: 'Case Start or Complete is not a valid timestamp',
  reversed_timestamps: 'Complete is earlier than Case Start',
};

/**
 * Single timing calculation shared by dashboard, case table, and Excel export.
 * Duration = Complete − Case Start (assignment.case_started_at → assignment.completed_at).
 * Returns null for attempts that are not completed (not a timing sample at all).
 */
export const caseTimingFor = (row: AnalyticsRow): { minutes: number } | { excluded: CaseTimingExclusion } | null => {
  if (row.status !== 'completed') return null;
  if (row.caseStartUnavailable) return { excluded: 'schema_not_migrated' };
  if (!row.caseStartedAt) return { excluded: 'start_not_recorded' };
  if (!row.completedAt) return { excluded: 'completion_not_recorded' };
  const start = Date.parse(row.caseStartedAt);
  const end = Date.parse(row.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { excluded: 'invalid_timestamp' };
  if (end < start) return { excluded: 'reversed_timestamps' };
  return { minutes: (end - start) / 60000 };
};

export const completionMinutesFor = (row: AnalyticsRow): number | null => {
  const timing = caseTimingFor(row);
  return timing && 'minutes' in timing ? timing.minutes : null;
};

export const SUBSCORE_DEFINITIONS = [
  { domain: 'Communication', key: 'focused_information_gathering', label: 'Focused information gathering', min: 0, max: 2 },
  { domain: 'Communication', key: 'closed_loop_team_communication', label: 'Closed-loop team communication', min: 0, max: 3 },
  { domain: 'Communication', key: 'efficiency_deduction', label: 'Efficiency deduction', min: -2, max: 0 },
  { domain: 'Clinical Reasoning', key: 'orders_monitoring_quality', label: 'Orders / monitoring quality', min: 0, max: 3 },
  { domain: 'Clinical Reasoning', key: 'clinical_reasoning_documentation', label: 'Reasoning / documentation', min: 0, max: 2 },
  { domain: 'Clinical Reasoning', key: 'safety_deduction', label: 'Safety deduction', min: -2, max: 0 },
] as const;
export type SubscorePerformance = {
  domain: string; key: string; label: string; min: number; max: number; average: number | null; scored: number;
  /** Assessed attempts in scope. Components are unavailable (not zero) where no valid structured subscore exists. */
  assessed: number; unavailable: number; unavailableReason: string | null;
};
const finiteScore = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const componentScoreFor = (row: AnalyticsRow, definition: (typeof SUBSCORE_DEFINITIONS)[number]): number | null => {
  const breakdown = definition.domain === 'Communication' ? row.communicationBreakdown : row.mdmBreakdown;
  const component = breakdown?.[definition.key];
  const value = component && typeof component === 'object' ? (component as Record<string, unknown>).score : component;
  return finiteScore(value) && value >= definition.min && value <= definition.max ? value : null;
};

const unavailableReasonFor = (rows: AnalyticsRow[], unavailable: number): string | null => {
  if (unavailable === 0) return null;
  const withoutBreakdown = rows.filter((row) => !row.communicationBreakdown && !row.mdmBreakdown).length;
  if (withoutBreakdown === rows.length) return 'Components unavailable: no structured subscores were recorded for these attempts (domain totals only). Not estimated.';
  return `${unavailable} of ${rows.length} attempts have no valid structured score for this component. Not estimated.`;
};

export const safetyFlagFor = (row: AnalyticsRow): { level: 'critical' | 'concern'; rationale: string; action: string } | null => {
  const safety = row.safetyResult ?? row.feedbackDebrief?.safety_result;
  if (!safety || typeof safety !== 'object') return null;
  const record = safety as Record<string, unknown>;
  if (record.level !== 'critical' && record.level !== 'concern') return null;
  return { level: record.level, rationale: typeof record.rationale === 'string' ? record.rationale : 'No rationale recorded.', action: typeof record.action === 'string' ? record.action : '' };
};

export const computeDashboardMetrics = (inputRows: AnalyticsRow[], eligibleLearners: number): DashboardMetrics => {
  const rows = uniqueByAssignmentId(inputRows).filter((row) => row.status !== 'cancelled');
  const base = computeCohortMetrics(rows, eligibleLearners);
  const assessed = rows.filter(isAssessed);
  const completionMinutes = rows.map(completionMinutesFor).filter(finiteScore);
  const trendMap = new Map<string, { attempts: number; completed: number; assessed: number }>();
  rows.forEach((row) => {
    const date = (row.completedAt ?? row.createdAt)?.slice(0, 10) ?? 'Unknown date';
    const current = trendMap.get(date) ?? { attempts: 0, completed: 0, assessed: 0 };
    current.attempts += 1;
    if (row.status === 'completed') current.completed += 1;
    if (isAssessed(row)) current.assessed += 1;
    trendMap.set(date, current);
  });
  const domainDefinitions = [
    { domain: 'Communication', values: assessed.map((row) => row.communicationScore) },
    { domain: 'Clinical Reasoning', values: assessed.map((row) => row.mdmScore) },
  ];
  const caseMap = new Map<number, AnalyticsRow[]>();
  rows.forEach((row) => caseMap.set(row.roomId, [...(caseMap.get(row.roomId) ?? []), row]));
  return {
    ...base,
    medianCompletionMinutes: median(completionMinutes),
    averageCompletionMinutes: average(completionMinutes),
    completionTimeSampleSize: completionMinutes.length,
    caseTiming: caseTimingSummary(rows),
    trend: [...trendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, ...value })),
    domainPerformance: domainDefinitions.map(({ domain, values }) => {
      const scored = values.filter(finiteScore);
      return { domain, average: average(scored), scored: scored.length, eligible: base.completedAssignments };
    }),
    subscorePerformance: SUBSCORE_DEFINITIONS.map((definition) => {
      const values = assessed.map((row) => componentScoreFor(row, definition)).filter(finiteScore);
      const unavailable = assessed.length - values.length;
      return { ...definition, average: average(values), scored: values.length, assessed: assessed.length, unavailable, unavailableReason: unavailableReasonFor(assessed, unavailable) };
    }),
    caseHeatmap: [...caseMap.entries()].map(([roomId, attempts]) => {
      const scored = attempts.filter(isAssessed);
      const communication = scored.map((row) => row.communicationScore).filter(finiteScore);
      const reasoning = scored.map((row) => row.mdmScore).filter(finiteScore);
      const times = attempts.map(completionMinutesFor).filter(finiteScore);
      return { roomId, caseLabel: attempts[0].roomNumber, schoolName: attempts[0].schoolName ?? 'Unknown school', specialty: attempts[0].specialty,
        attempts: attempts.length, completed: attempts.filter((row) => row.status === 'completed').length, assessed: scored.length,
        communicationAverage: average(communication), reasoningAverage: average(reasoning), communicationSamples: communication.length, reasoningSamples: reasoning.length,
        medianCompletionMinutes: median(times), averageCompletionMinutes: average(times), completionTimeSampleSize: times.length };
    }).sort((a, b) => a.caseLabel.localeCompare(b.caseLabel) || a.roomId - b.roomId),
  };
};

const caseTimingSummary = (rows: AnalyticsRow[]): CaseTimingSummary => {
  const exclusions: Record<CaseTimingExclusion, number> = { schema_not_migrated: 0, start_not_recorded: 0, completion_not_recorded: 0, invalid_timestamp: 0, reversed_timestamps: 0 };
  const attempts: CaseTimingAttempt[] = [];
  const minutes: number[] = [];
  rows.forEach((row) => {
    const timing = caseTimingFor(row);
    if (!timing) return;
    const base = { assignmentId: row.id, studentName: row.studentName, caseLabel: row.roomNumber, start: row.caseStartedAt ?? null, complete: row.completedAt };
    if ('minutes' in timing) {
      minutes.push(timing.minutes);
      attempts.push({ ...base, minutes: timing.minutes, exclusion: null, exclusionReason: null });
    } else {
      exclusions[timing.excluded] += 1;
      attempts.push({ ...base, minutes: null, exclusion: timing.excluded, exclusionReason: CASE_TIMING_EXCLUSION_LABELS[timing.excluded] });
    }
  });
  attempts.sort((a, b) => a.caseLabel.localeCompare(b.caseLabel) || a.studentName.localeCompare(b.studentName) || a.assignmentId.localeCompare(b.assignmentId));
  return { validSamples: minutes.length, completedAttempts: attempts.length, averageMinutes: average(minutes), medianMinutes: median(minutes), exclusions, attempts };
};

/**
 * Rubric-component evidence (the six structured subscores).
 * - Component drill-through shows each attempt's OWN saved explanation and evidence IDs for that component only.
 * - Comments are never fanned out across components. A component tag (`skill_key`, `component_key`,
 *   `skill_tags`, `rubric_components`) only files a comment under that component as EVIDENCE; it never makes a theme.
 * - Rows without a studentId never count toward distinct learners or the minimum threshold.
 */
export type RubricComponentAttempt = {
  assignmentId: string; learnerId: string | null; studentName: string; caseLabel: string; score: number;
  /** The saved explanation for this component on this attempt (null when none was saved). */
  explanation: string | null; evidenceIds: string[];
};
export type TaggedComponentComment = { assignmentId: string; learnerId: string; studentName: string; kind: 'strength' | 'improvement'; text: string; evidenceIds: string[]; behaviorKey: string | null };
export type RubricComponentTheme = {
  domain: string; key: string; label: string; min: number; max: number;
  validLearners: number; validAttempts: number; atMaxLearners: number; belowMaxLearners: number; unavailableAttempts: number;
  /** Attempts with a valid score but no known learner; listed but excluded from every learner count. */
  unknownLearnerAttempts: number;
  suppressed: boolean; minimumLearners: number;
  attempts: RubricComponentAttempt[];
  /** Comments carrying a stable tag for this component, from known learners only. */
  taggedComments: TaggedComponentComment[];
  taggedLearners: number;
  // Deliberately no `recurringTheme` flag: a broad component tag shared by unrelated comments is component
  // evidence only. Recurrence is decided by extractRecurringBehaviorThemes (same behavior key + same direction).
};

const COMPONENT_KEYS: ReadonlySet<string> = new Set(SUBSCORE_DEFINITIONS.map((d) => d.key));
const commentTagsFor = (item: Record<string, unknown>): string[] => {
  const raw = [item.skill_key, item.component_key, item.skill_tags, item.rubric_components].flat();
  return [...new Set(raw.filter((tag): tag is string => typeof tag === 'string' && COMPONENT_KEYS.has(tag)))];
};

const componentDetailFor = (row: AnalyticsRow, definition: (typeof SUBSCORE_DEFINITIONS)[number]): { explanation: string | null; evidenceIds: string[] } => {
  const breakdown = definition.domain === 'Communication' ? row.communicationBreakdown : row.mdmBreakdown;
  const component = breakdown?.[definition.key];
  if (!component || typeof component !== 'object') return { explanation: null, evidenceIds: [] };
  const record = component as Record<string, unknown>;
  const feedback = typeof record.feedback === 'string' ? record.feedback.replace(/\s+/g, ' ').trim() : '';
  return { explanation: feedback || null, evidenceIds: narrativeEvidenceIds(record as Narrative) };
};

const knownLearnerId = (row: AnalyticsRow): string | null => {
  const id = typeof row.studentId === 'string' ? row.studentId.trim() : '';
  return id && id.toLowerCase() !== 'unknown' ? id : null;
};

export const extractRubricComponentThemes = (rows: AnalyticsRow[], minimumLearners = 3): RubricComponentTheme[] => {
  const assessedRows = uniqueByAssignmentId(rows).filter(isAssessed);
  return SUBSCORE_DEFINITIONS.map((definition) => {
    const attempts: RubricComponentAttempt[] = [];
    const scoresByLearner = new Map<string, number[]>();
    let unavailableAttempts = 0;
    let unknownLearnerAttempts = 0;
    const taggedComments: TaggedComponentComment[] = [];
    assessedRows.forEach((row) => {
      const learnerId = knownLearnerId(row);
      const score = componentScoreFor(row, definition);
      if (score == null) unavailableAttempts += 1;
      else {
        if (learnerId) scoresByLearner.set(learnerId, [...(scoresByLearner.get(learnerId) ?? []), score]);
        else unknownLearnerAttempts += 1;
        attempts.push({ assignmentId: row.id, learnerId, studentName: row.studentName, caseLabel: row.roomNumber, score, ...componentDetailFor(row, definition) });
      }
      if (!learnerId) return;
      const collect = (values: unknown, kind: 'strength' | 'improvement') => {
        if (!Array.isArray(values)) return;
        values.forEach((raw) => {
          if (!raw || typeof raw !== 'object') return;
          const item = raw as Record<string, unknown>;
          if (!commentTagsFor(item).includes(definition.key)) return;
          const text = narrativeText(item as Narrative, kind === 'improvement');
          const evidenceIds = narrativeEvidenceIds(item as Narrative);
          if (!text || evidenceIds.length === 0) return;
          taggedComments.push({ assignmentId: row.id, learnerId, studentName: row.studentName, kind, text, evidenceIds, behaviorKey: behaviorKeyFor(item) });
        });
      };
      collect(row.feedbackDebrief?.strengths, 'strength');
      collect(row.feedbackDebrief?.improvements, 'improvement');
    });
    const validLearners = scoresByLearner.size;
    const taggedLearners = new Set(taggedComments.map((comment) => comment.learnerId)).size;
    return {
      domain: definition.domain, key: definition.key, label: definition.label, min: definition.min, max: definition.max,
      validLearners, validAttempts: attempts.length, unavailableAttempts, unknownLearnerAttempts,
      atMaxLearners: [...scoresByLearner.values()].filter((scores) => scores.some((score) => score === definition.max)).length,
      belowMaxLearners: [...scoresByLearner.values()].filter((scores) => scores.some((score) => score < definition.max)).length,
      suppressed: validLearners < minimumLearners, minimumLearners,
      attempts: attempts.sort((a, b) => a.studentName.localeCompare(b.studentName) || a.assignmentId.localeCompare(b.assignmentId)),
      taggedComments, taggedLearners,
    };
  });
};

/**
 * Stable behavior key slot. A future feedback generator may emit `behavior_key` (alias `behaviorKey`) on each saved
 * strength/improvement, e.g. "asks_about_allergies". The generator emits none today, so recurring themes are empty
 * until it does. Keys are matched EXACTLY after trimming; nothing is derived from free text.
 */
export const BEHAVIOR_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
export const behaviorKeyFor = (item: Record<string, unknown>): string | null => {
  const raw = item.behavior_key ?? item.behaviorKey;
  if (typeof raw !== 'string') return null;
  const key = raw.trim();
  return key.length >= 3 && key.length <= 80 && BEHAVIOR_KEY_PATTERN.test(key) ? key : null;
};

/** Recurring-theme threshold: a selectable 3 OR 5 distinct known learners (not "3 of 5"). Individual learner summaries use no threshold. */
export const THEME_MINIMUM_OPTIONS = [3, 5] as const;
export type ThemeMinimum = (typeof THEME_MINIMUM_OPTIONS)[number];
export const DEFAULT_THEME_MINIMUM: ThemeMinimum = 3;
export const normalizeThemeMinimum = (value: unknown): ThemeMinimum => (Number(value) === 5 ? 5 : DEFAULT_THEME_MINIMUM);

export type CommentDirection = 'strength' | 'improvement';
export type SavedComment = {
  assignmentId: string; learnerId: string | null; studentName: string; caseLabel: string; at: string | null;
  kind: CommentDirection; text: string; evidenceIds: string[];
  /** Rubric component keys carried by the saved comment's tags; empty = untagged (older) comment. */
  componentKeys: string[]; behaviorKey: string | null;
  /** 'debrief' = canonical saved debrief; 'legacy_evaluation_feedback' = older nurse_feedback copy, used only when the canonical field is absent. */
  source: 'debrief' | 'legacy_evaluation_feedback';
};

const isAbsentField = (value: unknown) => value === undefined || value === null;
const textKey = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
/** Legacy evaluation-feedback groups as stored on prod (`clinical_reasoning`, `communication_skills`); `communication` accepted for older writers. */
const LEGACY_FEEDBACK_GROUPS = ['clinical_reasoning', 'communication_skills', 'communication'] as const;

/**
 * Reads every saved strength/improvement on an attempt once; used by the learner overview and recurring themes.
 * - Canonical `feedback_debrief.strengths` / `.improvements` entries may be {text, evidence_event_ids} objects or plain strings.
 *   String comments carry no event IDs and are listed as saved evaluation feedback without linked evidence.
 * - Legacy `nurse_feedback.<group>.strengths|areas_for_improvement` is used ONLY when the canonical field is absent.
 *   A present-but-empty canonical list is a real answer and does not fall back. Canonical and legacy are never merged.
 * - Legacy comments never get invented evidence IDs, and identical text across legacy groups is listed once.
 */
export const savedCommentsFor = (row: AnalyticsRow): SavedComment[] => {
  const debrief = row.feedbackDebrief ?? {};
  const out: SavedComment[] = [];
  const base = { assignmentId: row.id, learnerId: knownLearnerId(row), studentName: row.studentName, caseLabel: row.roomNumber, at: row.completedAt ?? row.createdAt };
  const read = (values: unknown, kind: CommentDirection, source: SavedComment['source'] = 'debrief') => {
    if (!Array.isArray(values)) return;
    values.forEach((raw) => {
      if (typeof raw === 'string') {
        const text = narrativeText({ text: raw } as Narrative, false);
        if (text) out.push({ ...base, kind, text, evidenceIds: [], componentKeys: [], behaviorKey: null, source });
        return;
      }
      if (!raw || typeof raw !== 'object') return;
      const item = raw as Record<string, unknown>;
      const text = narrativeText(item as Narrative, kind === 'improvement');
      if (!text) return;
      out.push({ ...base, kind, text, evidenceIds: narrativeEvidenceIds(item as Narrative), componentKeys: commentTagsFor(item), behaviorKey: behaviorKeyFor(item), source });
    });
  };
  const legacy = (field: 'strengths' | 'areas_for_improvement') => {
    const feedback = row.nurseFeedback && typeof row.nurseFeedback === 'object' ? row.nurseFeedback as Record<string, unknown> : {};
    const seen = new Set<string>();
    return LEGACY_FEEDBACK_GROUPS.flatMap((group) => {
      const section = feedback[group];
      const list = section && typeof section === 'object' ? (section as Record<string, unknown>)[field] : undefined;
      return Array.isArray(list) ? list : [];
    }).filter((item): item is string => {
      if (typeof item !== 'string') return false;
      const key = textKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  if (isAbsentField(debrief.strengths)) read(legacy('strengths'), 'strength', 'legacy_evaluation_feedback'); else read(debrief.strengths, 'strength');
  if (isAbsentField(debrief.improvements)) read(legacy('areas_for_improvement'), 'improvement', 'legacy_evaluation_feedback'); else read(debrief.improvements, 'improvement');
  read(debrief.growth_areas, 'improvement');
  return out;
};

export type BehaviorTheme = { behaviorKey: string; direction: CommentDirection; learners: number; comments: SavedComment[] };
export type RecurringBehaviorThemes = {
  minimumLearners: number;
  recurringStrengths: BehaviorTheme[];
  recurringNeeds: BehaviorTheme[];
  /** Keyed behaviors below the threshold: shown as counts only, never claimed as recurring. */
  belowThreshold: BehaviorTheme[];
  keyedComments: number;
};

/**
 * A recurring strength/need is the SAME behavior key in the SAME direction across at least `minimumLearners`
 * distinct known learners (repeat attempts by one learner count once). Positive and improvement stay separate.
 * Evidence ids are required so a claim always links back to something the learner did.
 */
export const extractRecurringBehaviorThemes = (rows: AnalyticsRow[], minimumLearners = 3): RecurringBehaviorThemes => {
  const groups = new Map<string, BehaviorTheme>();
  let keyedComments = 0;
  uniqueByAssignmentId(rows).filter(isAssessed).forEach((row) => {
    savedCommentsFor(row).forEach((comment) => {
      if (!comment.behaviorKey || comment.evidenceIds.length === 0) return;
      keyedComments += 1;
      if (!comment.learnerId) return;
      const id = `${comment.kind}\u0000${comment.behaviorKey}`;
      const group = groups.get(id) ?? { behaviorKey: comment.behaviorKey, direction: comment.kind, learners: 0, comments: [] };
      group.comments.push(comment);
      group.learners = new Set(group.comments.map((item) => item.learnerId)).size;
      groups.set(id, group);
    });
  });
  const all = [...groups.values()].sort((a, b) => b.learners - a.learners || a.behaviorKey.localeCompare(b.behaviorKey));
  const meets = (theme: BehaviorTheme) => theme.learners >= minimumLearners;
  return {
    minimumLearners, keyedComments,
    recurringStrengths: all.filter((theme) => theme.direction === 'strength' && meets(theme)),
    recurringNeeds: all.filter((theme) => theme.direction === 'improvement' && meets(theme)),
    belowThreshold: all.filter((theme) => !meets(theme)),
  };
};

export type LearnerOverview = {
  evaluatedCases: number;
  basedOnOneEvaluation: boolean;
  firstDate: string | null; lastDate: string | null;
  strengths: SavedComment[];
  nextPractice: SavedComment[];
  /** Saved comments with no linked evidence. Kept visible, never promoted to "supported", never dropped. */
  unsupported: SavedComment[];
  components: Array<{ key: string; label: string; domain: string; min: number; max: number; entries: RubricComponentAttempt[]; taggedComments: SavedComment[] }>;
  /** Older comments without a component tag: shown once, labeled evaluation feedback, never copied under the six skills. */
  evaluationFeedback: SavedComment[];
  sources: Array<{ assignmentId: string; caseLabel: string; at: string | null }>;
};

/**
 * Deterministic per-learner overview from SAVED debrief strengths/improvements and component explanations.
 * No model calls. `rows` must already be scoped to one learner; assessed attempts only.
 */
export const buildLearnerOverview = (rows: AnalyticsRow[]): LearnerOverview => {
  const assessedRows = uniqueByAssignmentId(rows).filter(isAssessed)
    .sort((a, b) => (a.completedAt ?? a.createdAt ?? '').localeCompare(b.completedAt ?? b.createdAt ?? '') || a.id.localeCompare(b.id));
  const comments = assessedRows.flatMap(savedCommentsFor);
  const dates = assessedRows.map((row) => (row.completedAt ?? row.createdAt)?.slice(0, 10)).filter((d): d is string => Boolean(d));
  const supported = (c: SavedComment) => c.evidenceIds.length > 0;
  const components = SUBSCORE_DEFINITIONS.map((definition) => ({
    key: definition.key, label: definition.label, domain: definition.domain, min: definition.min, max: definition.max,
    entries: assessedRows.flatMap((row): RubricComponentAttempt[] => {
      const score = componentScoreFor(row, definition);
      return score == null ? [] : [{ assignmentId: row.id, learnerId: knownLearnerId(row), studentName: row.studentName, caseLabel: row.roomNumber, score, ...componentDetailFor(row, definition) }];
    }),
    taggedComments: comments.filter((c) => c.componentKeys.includes(definition.key)),
  }));
  return {
    evaluatedCases: assessedRows.length,
    basedOnOneEvaluation: assessedRows.length === 1,
    firstDate: dates[0] ?? null, lastDate: dates[dates.length - 1] ?? null,
    strengths: comments.filter((c) => c.kind === 'strength' && supported(c)),
    nextPractice: comments.filter((c) => c.kind === 'improvement' && supported(c)),
    unsupported: comments.filter((c) => !supported(c)),
    components,
    evaluationFeedback: comments.filter((c) => c.componentKeys.length === 0),
    sources: assessedRows.map((row) => ({ assignmentId: row.id, caseLabel: row.roomNumber, at: row.completedAt ?? row.createdAt })),
  };
};
