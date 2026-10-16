import { describe, expect, it } from 'vitest';
import {
  compactPrintText,
  conciseEfficiencyRationale,
  PRINT_COMPONENT_FEEDBACK_LIMIT,
  PRINT_EVENT_BODY_LIMIT,
  PRINT_SAFETY_TEXT_LIMIT,
  removeDiagnosisGoal,
  resolveCanonicalTotals,
} from './AssignmentDebrief';

describe('AssignmentDebrief presentation helpers', () => {
  it('keeps the room diagnosis separate from the goal bullets', () => {
    expect(removeDiagnosisGoal('Recognize Synthetic acute instability.', 'Synthetic acute instability')).toBeNull();
    expect(removeDiagnosisGoal('Reassess oxygenation after treatment.', 'Synthetic acute instability')).toBe('Reassess oxygenation after treatment.');
  });

  it('renders one concise efficiency rationale', () => {
    expect(conciseEfficiencyRationale('No case-specific efficiency deduction; No case-specific efficiency deduction was observed..', 0))
      .toBe('No case-specific efficiency deduction.');
    expect(conciseEfficiencyRationale('Repeated non-purposeful updates delayed the handoff.', -1))
      .toBe('Repeated non-purposeful updates delayed the handoff.');
    expect(conciseEfficiencyRationale('.', 0))
      .toBe('No case-specific efficiency deduction.');
  });

  it('uses canonical component arithmetic for both screen and print totals', () => {
    const totals = resolveCanonicalTotals(
      { communication_score: 1, clinical_reasoning_score: 1, mdm_score: 1 },
      {
        focused_information_gathering: { score: 2 },
        closed_loop_team_communication: { score: 3 },
        efficiency_deduction: { score: 0 },
      },
      {
        orders_monitoring_quality: { score: 3 },
        clinical_reasoning_documentation: { score: 2 },
        safety_deduction: { score: -1 },
      },
    );
    expect(totals).toEqual({ communication: 5, clinicalReasoning: 4 });
  });

  it('bounds long print feedback and event bodies without shrinking the print type', () => {
    const longText = 'Long clinical feedback '.repeat(100);
    expect(compactPrintText(longText, 'fallback', PRINT_COMPONENT_FEEDBACK_LIMIT)).toHaveLength(PRINT_COMPONENT_FEEDBACK_LIMIT);
    expect(compactPrintText(longText, 'fallback', PRINT_EVENT_BODY_LIMIT)).toHaveLength(PRINT_EVENT_BODY_LIMIT);
    expect(compactPrintText(longText, 'fallback', PRINT_SAFETY_TEXT_LIMIT)).toHaveLength(PRINT_SAFETY_TEXT_LIMIT);
    expect(compactPrintText(longText, 'fallback', PRINT_EVENT_BODY_LIMIT).endsWith('…')).toBe(true);
  });
});
