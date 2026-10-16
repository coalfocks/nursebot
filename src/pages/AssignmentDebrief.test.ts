import { describe, expect, it } from 'vitest';
import { conciseEfficiencyRationale, removeDiagnosisGoal } from './AssignmentDebrief';

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
  });
});
