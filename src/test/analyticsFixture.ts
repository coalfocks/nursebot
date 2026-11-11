import type { AnalyticsRow } from '../lib/analyticsMetrics';
export const analyticsFixture = (index = 0, overrides: Partial<AnalyticsRow> = {}): AnalyticsRow => ({
  id: `synthetic-attempt-${index}`, studentId: `synthetic-learner-${index}`, studentName: `Synthetic Learner ${index + 1}`, studentRole: 'student',
  schoolId: 'synthetic-school', schoolName: 'Synthetic Training School', roomId: index % 2 + 1, roomNumber: index % 2 ? '305' : '202', specialty: 'Medicine',
  status: 'completed', feedbackStatus: 'completed', communicationScore: 4, mdmScore: 3, overallScore: 3.5,
  createdAt: '2026-10-01T00:00:00Z', scoringStartAt: '2026-10-03T10:00:00Z', completedAt: '2026-10-03T10:20:00Z', feedbackGeneratedAt: '2026-10-03T10:21:00Z', caseDifficulty: 'intermediate',
  communicationBreakdown: { focused_information_gathering: { score: 2 }, closed_loop_team_communication: { score: 2 }, efficiency_deduction: { score: 0 } },
  mdmBreakdown: { orders_monitoring_quality: { score: 2 }, clinical_reasoning_documentation: { score: 1 }, safety_deduction: { score: 0 } },
  nurseFeedback: null, feedbackDebrief: { strengths: [{ text: 'Focused escalation to the senior clinician', evidence_event_ids: [`synthetic-event-${index}`] }], improvements: [{ text: 'Document reassessment after urgent monitoring', evidence_event_ids: [`synthetic-event-${index}`] }] },
  ...overrides,
});
