import { describe, expect, it } from 'vitest';
import { buildComparison, sideFromAssignment, sideFromVersion, type FeedbackRerunVersion } from './feedbackRerun';

const comp = (score: number | null) => ({ score, feedback: 'x' });
const assignment = {
  feedback_generated_at: '2026-11-01T00:00:00Z', communication_score: 4, mdm_score: 3,
  communication_breakdown: { focused_information_gathering: comp(2), closed_loop_team_communication: comp(2), efficiency_deduction: comp(0) },
  mdm_breakdown: { orders_monitoring_quality: comp(2), clinical_reasoning_documentation: comp(1), safety_deduction: comp(0) },
  safety_result: { level: 'none', action: null, rationale: null },
  feedback_debrief: { strengths: [{ text: 'old strength' }], improvements: [{ text: 'old improvement' }], prompt_id: 'p1', prompt_sha256: 'aaa', model: 'gpt-6-luna' },
};
const version: FeedbackRerunVersion = {
  id: 'v1', assignment_id: 'a', status: 'completed', technical_incomplete: false, error: null, created_at: '2026-11-20T10:00:00Z', promoted_at: null,
  provenance: { model: 'gpt-6-luna', prompt_id: 'p1', prompt_sha256: 'aaa', context_block_id: 'ctx-1', context_block_sha256: 'bbb', context_rendered_sha256: 'ccc', context_missing: ['hpi'], generated_at: '2026-11-20T10:01:00Z' },
  result: {
    evaluation: {
      communication_score: 5, clinical_reasoning_score: 3,
      communication_breakdown: { focused_information_gathering: comp(2), closed_loop_team_communication: comp(3), efficiency_deduction: comp(0) },
      clinical_reasoning_breakdown: { orders_monitoring_quality: comp(2), clinical_reasoning_documentation: comp(1), safety_deduction: comp(0) },
      safety_result: { level: 'concern', action: 'delayed escalation', rationale: 'r' },
    },
    debrief: { strengths: [{ text: 'new strength' }], improvements: [{ text: 'new improvement' }] },
  },
};

describe('rerun comparison', () => {
  const rows = buildComparison(sideFromAssignment(assignment), sideFromVersion(version));
  const get = (label: string) => rows.find((row) => row.label === label)!;
  it('shows scores, components, safety, comments and provenance side by side', () => {
    expect(get('Communication score')).toMatchObject({ saved: '4', rerun: '5', changed: true });
    expect(get('Medical decision-making score')).toMatchObject({ saved: '3', rerun: '3', changed: false });
    expect(get('Component: closed loop team communication')).toMatchObject({ saved: '2', rerun: '3', changed: true });
    expect(get('Safety level')).toMatchObject({ saved: 'none', rerun: 'concern', changed: true });
    expect(get('Strengths')).toMatchObject({ saved: 'old strength', rerun: 'new strength' });
    expect(get('Improvements')).toMatchObject({ saved: 'old improvement', rerun: 'new improvement' });
    expect(get('Model').changed).toBe(false);
    expect(get('Evaluator prompt hash')).toMatchObject({ saved: 'aaa', rerun: 'aaa' });
    expect(get('Context framing hash')).toMatchObject({ saved: '—', rerun: 'bbb', changed: true });
    expect(get('Context hash (rendered)').rerun).toBe('ccc');
    expect(get('Context missing fields').rerun).toBe('hpi');
    expect(get('Generated at').saved).toBe('2026-11-01T00:00:00Z');
  });
  it('treats an old saved result with no context provenance as missing, not as an error', () => {
    expect(sideFromAssignment({ feedback_debrief: null }).provenance.contextBlockSha256).toBeNull();
  });
  it('does not mutate the saved assignment object', () => {
    const copy = JSON.stringify(assignment);
    buildComparison(sideFromAssignment(assignment), sideFromVersion(version));
    expect(JSON.stringify(assignment)).toBe(copy);
  });
});
