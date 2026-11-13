import { describe, expect, it } from 'vitest';
import { mapFeedbackSheet, renderFeedbackSheetHtml } from './feedbackSheet';

describe('feedback sheet nullable score mapping', () => {
  it('keeps observed zero distinct from unassessable components and dependent totals', () => {
    const model = mapFeedbackSheet({
      communication_score: null,
      mdm_score: null,
      communication_breakdown: {
        focused_information_gathering: { score: 0, feedback: 'No focused evidence observed.', evidence_event_ids: ['e1'] },
        closed_loop_team_communication: { score: null, feedback: 'Source missing.', not_scored_reason: 'Consult capture is incomplete.' },
        efficiency_deduction: { score: 0, feedback: 'No observed interference.' },
      },
      mdm_breakdown: {
        orders_monitoring_quality: { score: null, feedback: 'Missing order source.', not_scored_reason: 'Order history was not captured.' },
        clinical_reasoning_documentation: { score: 1, feedback: 'Reasoning observed.' },
        safety_deduction: { score: null, feedback: 'Safety not reviewed.', not_scored_reason: 'Safety evidence is unavailable.' },
      },
      safety_result: { level: 'not_assessed', action: null, rationale: 'Capture incomplete.' },
    });
    expect(model.communication[0].score).toBe('0');
    expect(model.communication[1].score).toBe('Not scored');
    expect(model.communication[1].notScoredReason).toBe('Consult capture is incomplete.');
    expect(model.communicationScore).toBeNull();
    expect(model.clinicalReasoning[2].score).toBe('Not scored');
    expect(model.clinicalReasoningScore).toBeNull();
    const html = renderFeedbackSheetHtml(model);
    expect(html).toContain('Not scored');
    expect(html).toContain('Consult capture is incomplete.');
  });
});
