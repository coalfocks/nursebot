export const FEEDBACK_RUBRIC_VERSION = 'feedback-v2-2026-10-15';
export const CASE_KEY_VERSION = 'case-key-v2';
export const ASSESSMENT_VERSION = 'assessment-v2-2026-10-15';

export type SafetyLevel = 'none' | 'concern' | 'critical';

export type SafetyResult = {
  level: SafetyLevel;
  action: string | null;
  rationale: string | null;
  evidence_event_ids: string[];
};

export type CaseEvaluationKey = {
  version: string;
  goals: string[];
  acuity_urgency_trigger: string | null;
  expected_endpoint: string | null;
  time_sensitive_actions: string[];
  must: string[];
  should: string[];
  could: string[];
  should_not: string[];
  must_not: string[];
  acceptable_alternative_paths: string[];
  decision_critical_questions_findings: string[];
  note_elements: string[];
  observed_channels: string[];
  safety_rationale: string | null;
};

const asStrings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  : [];

export const resolveCaseEvaluationKey = (room: Record<string, unknown>): CaseEvaluationKey => {
  let packageEvaluation: Record<string, unknown> = {};
  try {
    const parsed = typeof room.emr_context === 'string' ? JSON.parse(room.emr_context) : room.emr_context;
    packageEvaluation = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? ((parsed as Record<string, unknown>).evaluation as Record<string, unknown> ?? {})
      : {};
  } catch {
    packageEvaluation = {};
  }
  const source = { ...packageEvaluation };
  return {
    version: typeof source.version === 'string' ? source.version : CASE_KEY_VERSION,
    goals: asStrings(source.goals ?? room.case_goals),
    acuity_urgency_trigger: typeof source.acuityUrgencyTrigger === 'string'
      ? source.acuityUrgencyTrigger : (typeof room.bedside_requirement === 'string' ? room.bedside_requirement : null),
    expected_endpoint: typeof source.expectedEndpoint === 'string' ? source.expectedEndpoint : null,
    time_sensitive_actions: asStrings(source.timeSensitiveActions),
    must: asStrings(source.must ?? source.criticalActions),
    should: asStrings(source.should),
    could: asStrings(source.could),
    should_not: asStrings(source.shouldNot),
    must_not: asStrings(source.mustNot ?? source.unsafeActions),
    acceptable_alternative_paths: asStrings(source.acceptableAlternativePaths),
    decision_critical_questions_findings: asStrings(source.decisionCriticalQuestionsFindings ?? source.expectedWorkup),
    note_elements: asStrings(source.noteElements),
    observed_channels: asStrings(source.observedChannels ?? ['bedside', 'patient', 'nurse_team', 'chart', 'orders_results', 'note']),
    safety_rationale: typeof source.safetyRationale === 'string' ? source.safetyRationale : null,
  };
};

export const deriveScoringStart = (messages: Array<{ id?: string | number | null; role: string; content: string; created_at: string | null }>) => {
  const firstPage = messages
    .filter((message) => message.role === 'assistant' || message.role === 'nurse')
    .filter((message) => message.content !== '<completed>' && message.created_at)
    .sort((a, b) => new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime())[0];
  return firstPage ? { scoring_start_at: new Date(firstPage.created_at!).toISOString(), event_id: String(firstPage.id ?? '') } : null;
};

export const isPostPageEvent = (timestamp: string, scoringStartAt: string | null) =>
  Boolean(scoringStartAt && new Date(timestamp).getTime() >= new Date(scoringStartAt).getTime());

export const formativeNotice = 'Formative feedback for learning only; this is not an ACGME Milestone, EPA entrustment decision, or validated competence determination.';
