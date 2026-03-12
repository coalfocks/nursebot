import { COMMUNICATION_SCORING, MDM_SCORING } from './evaluation-prompts.ts';

export interface EvaluationScoringResponse {
  learning_objectives: string;
  communication_score: number;
  mdm_score: number;
  communication_breakdown: {
    information_sharing: {
      score: number;
      feedback: string;
    };
    responsive_communication: {
      score: number;
      feedback: string;
    };
    efficiency_deduction: {
      score: number;
      feedback: string;
      cau_count: number;
      case_difficulty: string;
    };
  };
  mdm_breakdown: {
    labs_orders_quality: {
      score: number;
      feedback: string;
    };
    note_thought_process: {
      score: number;
      feedback: string;
    };
    safety_deduction: {
      score: number;
      feedback: string;
    };
  };
  recommendations: string[];
}

type CommunicationScoreKey = 0 | 1 | 2 | 3 | -1 | -2;
type MdmScoreKey = 0 | 1 | 2 | 3 | -1 | -2;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const getCommunicationFeedback = (
  section: 'informationSharing' | 'responsiveCommunication' | 'efficiencyDeduction',
  score: CommunicationScoreKey,
) => {
  const scoreKey = String(score) as keyof typeof COMMUNICATION_SCORING.informationSharing.scores;
  if (section === 'informationSharing') {
    return COMMUNICATION_SCORING.informationSharing.scores[score as 0 | 1 | 2].feedback;
  }
  if (section === 'responsiveCommunication') {
    return COMMUNICATION_SCORING.responsiveCommunication.scores[score as 0 | 1 | 2 | 3].feedback;
  }
  return COMMUNICATION_SCORING.efficiencyDeduction.scores[scoreKey as '-2' | '-1' | 0].feedback;
};

export const getMdmFeedback = (
  section: 'labsOrdersQuality' | 'noteThoughtProcess' | 'safetyDeduction',
  score: MdmScoreKey,
) => {
  const scoreKey = String(score) as keyof typeof MDM_SCORING.labsOrdersQuality.scores;
  if (section === 'labsOrdersQuality') {
    return MDM_SCORING.labsOrdersQuality.scores[score as 0 | 1 | 2 | 3].feedback;
  }
  if (section === 'noteThoughtProcess') {
    return MDM_SCORING.noteThoughtProcess.scores[score as 0 | 1 | 2].feedback;
  }
  return MDM_SCORING.safetyDeduction.scores[scoreKey as '-2' | '-1' | 0].feedback;
};

export const canonicalizeEvaluation = (
  evaluation: EvaluationScoringResponse,
  caseDifficulty: string,
): EvaluationScoringResponse => {
  const informationScore = clamp(Math.round(evaluation.communication_breakdown?.information_sharing?.score ?? 0), 0, 2) as 0 | 1 | 2;
  const responsiveScore = clamp(Math.round(evaluation.communication_breakdown?.responsive_communication?.score ?? 0), 0, 3) as 0 | 1 | 2 | 3;
  const efficiencyScore = clamp(Math.round(evaluation.communication_breakdown?.efficiency_deduction?.score ?? 0), -2, 0) as -2 | -1 | 0;
  const labsOrdersScore = clamp(Math.round(evaluation.mdm_breakdown?.labs_orders_quality?.score ?? 0), 0, 3) as 0 | 1 | 2 | 3;
  const noteThoughtScore = clamp(Math.round(evaluation.mdm_breakdown?.note_thought_process?.score ?? 0), 0, 2) as 0 | 1 | 2;
  const safetyScore = clamp(Math.round(evaluation.mdm_breakdown?.safety_deduction?.score ?? 0), -2, 0) as -2 | -1 | 0;

  const communicationScore = clamp(informationScore + responsiveScore + efficiencyScore, 0, 5);
  const mdmScore = clamp(labsOrdersScore + noteThoughtScore + safetyScore, 0, 5);

  return {
    ...evaluation,
    communication_score: communicationScore,
    mdm_score: mdmScore,
    communication_breakdown: {
      information_sharing: {
        score: informationScore,
        feedback: getCommunicationFeedback('informationSharing', informationScore),
      },
      responsive_communication: {
        score: responsiveScore,
        feedback: getCommunicationFeedback('responsiveCommunication', responsiveScore),
      },
      efficiency_deduction: {
        score: efficiencyScore,
        feedback: getCommunicationFeedback('efficiencyDeduction', efficiencyScore),
        cau_count: Math.max(0, Math.round(evaluation.communication_breakdown?.efficiency_deduction?.cau_count ?? 0)),
        case_difficulty: caseDifficulty,
      },
    },
    mdm_breakdown: {
      labs_orders_quality: {
        score: labsOrdersScore,
        feedback: getMdmFeedback('labsOrdersQuality', labsOrdersScore),
      },
      note_thought_process: {
        score: noteThoughtScore,
        feedback: getMdmFeedback('noteThoughtProcess', noteThoughtScore),
      },
      safety_deduction: {
        score: safetyScore,
        feedback: getMdmFeedback('safetyDeduction', safetyScore),
      },
    },
    recommendations: [
      getCommunicationFeedback('informationSharing', informationScore),
      getCommunicationFeedback('responsiveCommunication', responsiveScore),
      getCommunicationFeedback('efficiencyDeduction', efficiencyScore),
      getMdmFeedback('labsOrdersQuality', labsOrdersScore),
      getMdmFeedback('noteThoughtProcess', noteThoughtScore),
      getMdmFeedback('safetyDeduction', safetyScore),
    ],
  };
};
