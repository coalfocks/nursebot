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
  safetyResult?: Record<string, unknown> | null;
  completedAt: string | null;
  feedbackGeneratedAt: string | null;
  caseDifficulty: string | null;
  communicationBreakdown: Record<string, unknown> | null;
  mdmBreakdown: Record<string, unknown> | null;
  nurseFeedback: Record<string, unknown> | null;
  feedbackDebrief: Record<string, unknown> | null;
};

export type DashboardMetrics = CohortMetrics & {
  medianCompletionMinutes: number | null;
  completionTimeSampleSize: number;
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
  medianCompletionMinutes: number | null; completionTimeSampleSize: number;
};

export const isAssessed = (row: AnalyticsAssignment) => row.status === 'completed' && row.feedbackStatus === 'completed';

export const completionMinutesFor = (row: AnalyticsRow): number | null => {
  if (row.status !== 'completed' || !row.scoringStartAt || !row.completedAt) return null;
  const minutes = (Date.parse(row.completedAt) - Date.parse(row.scoringStartAt)) / 60000;
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
};

export const SUBSCORE_DEFINITIONS = [
  { domain: 'Communication', key: 'focused_information_gathering', label: 'Focused information gathering', min: 0, max: 2 },
  { domain: 'Communication', key: 'closed_loop_team_communication', label: 'Closed-loop team communication', min: 0, max: 3 },
  { domain: 'Communication', key: 'efficiency_deduction', label: 'Efficiency deduction', min: -2, max: 0 },
  { domain: 'Clinical Reasoning', key: 'orders_monitoring_quality', label: 'Orders / monitoring quality', min: 0, max: 3 },
  { domain: 'Clinical Reasoning', key: 'clinical_reasoning_documentation', label: 'Reasoning / documentation', min: 0, max: 2 },
  { domain: 'Clinical Reasoning', key: 'safety_deduction', label: 'Safety deduction', min: -2, max: 0 },
] as const;
export type SubscorePerformance = { domain: string; label: string; min: number; max: number; average: number | null; scored: number };
const finiteScore = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

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
    completionTimeSampleSize: completionMinutes.length,
    trend: [...trendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, ...value })),
    domainPerformance: domainDefinitions.map(({ domain, values }) => {
      const scored = values.filter(finiteScore);
      return { domain, average: average(scored), scored: scored.length, eligible: base.completedAssignments };
    }),
    subscorePerformance: SUBSCORE_DEFINITIONS.map((definition) => {
      const values = assessed.map((row) => {
        const breakdown = definition.domain === 'Communication' ? row.communicationBreakdown : row.mdmBreakdown;
        const component = breakdown?.[definition.key];
        return component && typeof component === 'object' ? (component as Record<string, unknown>).score : component;
      }).filter(finiteScore).filter((value) => value >= definition.min && value <= definition.max);
      return { ...definition, average: average(values), scored: values.length };
    }),
    caseHeatmap: [...caseMap.entries()].map(([roomId, attempts]) => {
      const scored = attempts.filter(isAssessed);
      const communication = scored.map((row) => row.communicationScore).filter(finiteScore);
      const reasoning = scored.map((row) => row.mdmScore).filter(finiteScore);
      const times = attempts.map(completionMinutesFor).filter(finiteScore);
      return { roomId, caseLabel: attempts[0].roomNumber, schoolName: attempts[0].schoolName ?? 'Unknown school', specialty: attempts[0].specialty,
        attempts: attempts.length, completed: attempts.filter((row) => row.status === 'completed').length, assessed: scored.length,
        communicationAverage: average(communication), reasoningAverage: average(reasoning), communicationSamples: communication.length, reasoningSamples: reasoning.length,
        medianCompletionMinutes: median(times), completionTimeSampleSize: times.length };
    }).sort((a, b) => a.caseLabel.localeCompare(b.caseLabel) || a.roomId - b.roomId),
  };
};
