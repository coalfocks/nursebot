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
  caseHeatmap: Array<{ caseLabel: string; attempts: number; completed: number; average: number | null }>;
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

export const ANALYTICS_METRIC_VERSION = '2026-10-16.1';

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
    name: 'Assessment coverage',
    unit: 'percent',
    numerator: 'completed opportunities with a valid assessment',
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

const uniqueByAssignmentId = <T extends AnalyticsAssignment>(assignments: T[]): T[] => {
  const seen = new Set<string>();
  return assignments.filter((assignment, index) => {
    const id = assignment.id ?? `row-${index}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
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

export const extractEvidenceBackedThemes = (rows: AnalyticsRow[]): { strengths: AnalyticsTheme[]; growth: AnalyticsTheme[] } => {
  const collect = (target: Map<string, AnalyticsTheme>, values: unknown, growth: boolean) => {
    if (!Array.isArray(values)) return;
    values.forEach((raw) => {
      if (!raw || typeof raw !== 'object') return;
      const item = raw as Narrative;
      const text = narrativeText(item, growth);
      if (!text || narrativeEvidenceIds(item).length === 0) return;
      const key = text.toLocaleLowerCase();
      const existing = target.get(key);
      if (existing) existing.count += 1;
      else target.set(key, { text, count: 1 });
    });
  };
  const strengths = new Map<string, AnalyticsTheme>();
  const growth = new Map<string, AnalyticsTheme>();
  uniqueByAssignmentId(rows).forEach((row) => {
    const debrief = row.feedbackDebrief ?? {};
    collect(strengths, debrief.strengths, false);
    collect(growth, debrief.growth_areas, true);
    collect(growth, debrief.improvements, true);
  });
  return { strengths: [...strengths.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)), growth: [...growth.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)) };
};

const average = (values: number[]) =>
  values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(1));
};

export const computeDashboardMetrics = (rows: AnalyticsRow[], eligibleLearners: number): DashboardMetrics => {
  const base = computeCohortMetrics(rows, eligibleLearners);
  const completionMinutes = rows
    .filter((row) => row.status === 'completed' && row.createdAt && row.completedAt)
    .map((row) => (new Date(row.completedAt as string).getTime() - new Date(row.createdAt as string).getTime()) / 60000)
    .filter((value) => Number.isFinite(value) && value >= 0);

  const trendMap = new Map<string, { attempts: number; completed: number; assessed: number }>();
  rows.forEach((row) => {
    const date = (row.completedAt ?? row.createdAt)?.slice(0, 10) ?? 'Unknown date';
    const current = trendMap.get(date) ?? { attempts: 0, completed: 0, assessed: 0 };
    current.attempts += 1;
    if (row.status === 'completed') current.completed += 1;
    if (row.status === 'completed' && row.feedbackStatus === 'completed') current.assessed += 1;
    trendMap.set(date, current);
  });

  const domainDefinitions = [
    { domain: 'Communication', values: rows.map((row) => row.communicationScore) },
    { domain: 'Medical decision-making', values: rows.map((row) => row.mdmScore) },
  ];

  const caseMap = new Map<string, { attempts: number; completed: number; scores: number[] }>();
  rows.forEach((row) => {
    const label = row.roomNumber || `Room ${row.roomId}`;
    const current = caseMap.get(label) ?? { attempts: 0, completed: 0, scores: [] };
    current.attempts += 1;
    if (row.status === 'completed') current.completed += 1;
    if (typeof row.overallScore === 'number') current.scores.push(row.overallScore);
    caseMap.set(label, current);
  });

  return {
    ...base,
    medianCompletionMinutes: median(completionMinutes),
    completionTimeSampleSize: completionMinutes.length,
    trend: [...trendMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, ...value })),
    domainPerformance: domainDefinitions.map(({ domain, values }) => {
      const scored = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      return { domain, average: average(scored), scored: scored.length, eligible: rows.length };
    }),
    caseHeatmap: [...caseMap.entries()].map(([caseLabel, value]) => ({
      caseLabel,
      attempts: value.attempts,
      completed: value.completed,
      average: average(value.scores),
    })).sort((a, b) => a.caseLabel.localeCompare(b.caseLabel)),
  };
};
