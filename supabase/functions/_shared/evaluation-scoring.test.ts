import { describe, expect, it } from 'vitest';
import { canonicalizeEvaluation } from './evaluation-scoring';
import { COMMUNICATION_SCORING, MDM_SCORING } from './evaluation-prompts';

describe('canonicalizeEvaluation', () => {
  it('recomputes totals and replaces subsection feedback with canonical rubric lines', () => {
    const result = canonicalizeEvaluation(
      {
        learning_objectives: 'Focus on safer prioritization.',
        communication_score: 99,
        mdm_score: 99,
        communication_breakdown: {
          information_sharing: {
            score: 2,
            feedback: 'custom drifted text',
          },
          responsive_communication: {
            score: 3,
            feedback: 'another drifted line',
          },
          efficiency_deduction: {
            score: -1,
            feedback: 'wrong feedback',
            cau_count: 5.7,
            case_difficulty: 'wrong',
          },
        },
        mdm_breakdown: {
          labs_orders_quality: {
            score: 3,
            feedback: 'not canonical',
          },
          note_thought_process: {
            score: 2,
            feedback: 'not canonical either',
          },
          safety_deduction: {
            score: -2,
            feedback: 'also wrong',
          },
        },
        recommendations: ['freeform recommendation'],
      },
      'advanced',
    );

    expect(result.communication_score).toBe(4);
    expect(result.mdm_score).toBe(3);
    expect(result.communication_breakdown.information_sharing.feedback).toBe(
      COMMUNICATION_SCORING.informationSharing.scores[2].feedback,
    );
    expect(result.communication_breakdown.responsive_communication.feedback).toBe(
      COMMUNICATION_SCORING.responsiveCommunication.scores[3].feedback,
    );
    expect(result.communication_breakdown.efficiency_deduction.feedback).toBe(
      COMMUNICATION_SCORING.efficiencyDeduction.scores['-1'].feedback,
    );
    expect(result.communication_breakdown.efficiency_deduction.cau_count).toBe(6);
    expect(result.communication_breakdown.efficiency_deduction.case_difficulty).toBe('advanced');
    expect(result.mdm_breakdown.labs_orders_quality.feedback).toBe(
      MDM_SCORING.labsOrdersQuality.scores[3].feedback,
    );
    expect(result.mdm_breakdown.note_thought_process.feedback).toBe(
      MDM_SCORING.noteThoughtProcess.scores[2].feedback,
    );
    expect(result.mdm_breakdown.safety_deduction.feedback).toBe(
      MDM_SCORING.safetyDeduction.scores['-2'].feedback,
    );
    expect(result.recommendations).toEqual([
      COMMUNICATION_SCORING.informationSharing.scores[2].feedback,
      COMMUNICATION_SCORING.responsiveCommunication.scores[3].feedback,
      COMMUNICATION_SCORING.efficiencyDeduction.scores['-1'].feedback,
      MDM_SCORING.labsOrdersQuality.scores[3].feedback,
      MDM_SCORING.noteThoughtProcess.scores[2].feedback,
      MDM_SCORING.safetyDeduction.scores['-2'].feedback,
    ]);
  });

  it('clamps out-of-range subsection scores before deriving totals', () => {
    const result = canonicalizeEvaluation(
      {
        learning_objectives: 'text',
        communication_score: 0,
        mdm_score: 0,
        communication_breakdown: {
          information_sharing: {
            score: 5,
            feedback: '',
          },
          responsive_communication: {
            score: -2,
            feedback: '',
          },
          efficiency_deduction: {
            score: -9,
            feedback: '',
            cau_count: -10,
            case_difficulty: '',
          },
        },
        mdm_breakdown: {
          labs_orders_quality: {
            score: 7,
            feedback: '',
          },
          note_thought_process: {
            score: -3,
            feedback: '',
          },
          safety_deduction: {
            score: 4,
            feedback: '',
          },
        },
        recommendations: [],
      },
      'easy',
    );

    expect(result.communication_breakdown.information_sharing.score).toBe(2);
    expect(result.communication_breakdown.responsive_communication.score).toBe(0);
    expect(result.communication_breakdown.efficiency_deduction.score).toBe(-2);
    expect(result.communication_score).toBe(0);
    expect(result.mdm_breakdown.labs_orders_quality.score).toBe(3);
    expect(result.mdm_breakdown.note_thought_process.score).toBe(0);
    expect(result.mdm_breakdown.safety_deduction.score).toBe(0);
    expect(result.mdm_score).toBe(3);
    expect(result.communication_breakdown.efficiency_deduction.cau_count).toBe(0);
  });
});
