export type AnalyticsAssignment = {
  status: string | null;
  feedbackStatus: string | null;
  studentId: string | null;
  communicationScore: number | null;
  mdmScore: number | null;
  overallScore: number | null;
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

export const ANALYTICS_METRIC_VERSION = '2026-10-06.1';

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
  const eligible = assignments.filter((assignment) => assignment.status !== 'cancelled');
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
