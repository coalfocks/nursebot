import { describe, expect, it } from 'vitest';
import { mapFeedbackSheet, renderFeedbackSheetHtml } from './feedbackSheet';

const scored = {
  communication_score: 4,
  mdm_score: 3,
  communication_breakdown: {
    focused_information_gathering: { score: 2, feedback: 'Focused.', evidence_event_ids: ['e1'] },
    closed_loop_team_communication: { score: 2, feedback: 'Loop.', evidence_event_ids: ['e2'] },
    efficiency_deduction: { score: 0, feedback: 'None.' },
  },
  mdm_breakdown: {
    orders_monitoring_quality: { score: 2, feedback: 'Monitoring.', evidence_event_ids: ['o1'] },
    clinical_reasoning_documentation: { score: 1, feedback: 'Reasoning.' },
    safety_deduction: { score: 0, feedback: 'None.' },
  },
  safety_result: { level: 'none', action: null, rationale: 'No unsafe action.' },
};

describe('commentary error display', () => {
  it('keeps saved scores visible and shows a separate commentary error', () => {
    const model = mapFeedbackSheet({
      ...scored,
      feedback_debrief: { strengths: [], improvements: [], comment_error: 'Commentary generation failed validation (model response failed contract validation).' },
    } as never);
    expect(model.communicationScore).toBe(4);
    expect(model.clinicalReasoningScore).toBe(3);
    expect(model.commentError).toContain('failed validation');
    expect(renderFeedbackSheetHtml(model)).toContain('Commentary unavailable');
  });

  it('shows no commentary error section when comments were generated', () => {
    const model = mapFeedbackSheet({
      ...scored,
      feedback_debrief: { strengths: [{ text: 'One.', evidence_event_ids: ['e1'] }, { text: 'Two.', evidence_event_ids: ['e2'] }], improvements: [{ text: 'Three.', evidence_event_ids: ['o1'] }, { text: 'Four.', evidence_event_ids: ['o1'] }], comment_error: null },
    } as never);
    expect(model.commentError).toBeNull();
    expect(renderFeedbackSheetHtml(model)).not.toContain('Commentary unavailable');
  });
});
