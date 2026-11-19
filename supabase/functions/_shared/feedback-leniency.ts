// Per-room evaluation leniency multiplier (set in RoomEditor as
// emr_context.evaluation.leniencyMultiplier). Factor F > 1 (lenient room):
//   - Positive components get +1 only when the grader flagged them borderline_up (a close
//     call just below the next integer level). Targets roughly (F - 1) of graded cases.
//     Scores are never raised above the component max, and unflagged scores are untouched.
//   - Deductions are pulled toward zero (ceil), as before.
// Factor F < 1 (strict room) keeps the earlier behavior: positives scaled and rounded,
// deductions pushed away from zero (floor).
// F === 1 returns the evaluation unchanged, so default rooms score exactly as before.
// The safety LEVEL label is never changed by the multiplier; only the numeric safety
// deduction is scaled.
import { canonicalizeEvaluation, type EvaluationScoringResponse, type ScoredComponent } from './evaluation-scoring.ts';

export const LENIENCY_MIN = 0.75;
export const LENIENCY_MAX = 1.5;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const normalizeLeniencyMultiplier = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return 1;
  return clamp(Number(numeric.toFixed(2)), LENIENCY_MIN, LENIENCY_MAX);
};

// Reads the room's saved multiplier. Missing, malformed, or unparseable values
// fall back to 1 (no modifier) rather than failing the grading run.
export const readRoomLeniencyMultiplier = (room: Record<string, unknown>): number => {
  try {
    const parsed = typeof room.emr_context === 'string' ? JSON.parse(room.emr_context) : room.emr_context;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 1;
    const evaluation = (parsed as Record<string, unknown>).evaluation;
    if (!evaluation || typeof evaluation !== 'object') return 1;
    return normalizeLeniencyMultiplier((evaluation as Record<string, unknown>).leniencyMultiplier);
  } catch {
    return 1;
  }
};

const withScore = (component: ScoredComponent, score: number | null): ScoredComponent => ({ ...component, score });

const scalePositive = (score: number | null, max: number, multiplier: number) =>
  score == null ? null : clamp(Math.round(score * multiplier), 0, max);

// Lenient-room lift: +1 only for a flagged close call that is strictly below the max.
const liftBorderline = (component: ScoredComponent, max: number): Pick<ScoredComponent, 'score' | 'leniency_bumped'> => {
  const bump = component.score != null && component.borderline_up === true && component.score < max;
  return bump ? { score: component.score! + 1, leniency_bumped: true } : { score: component.score };
};

const positiveFor = (component: ScoredComponent, max: number, multiplier: number): ScoredComponent => {
  if (multiplier > 1) {
    const lifted = liftBorderline(component, max);
    return { ...component, score: lifted.score, leniency_bumped: lifted.leniency_bumped ?? false };
  }
  return withScore(component, scalePositive(component.score, max, multiplier));
};

// Extra output instruction, added to the grader request ONLY for lenient rooms, so
// default (F = 1) requests are byte-identical to the approved prompt. It asks for a
// separate flag and never changes the rubric text, anchors, or score.
export const borderlineFlagInstruction = (rawMultiplier: unknown): string => {
  if (normalizeLeniencyMultiplier(rawMultiplier) <= 1) return '';
  return 'BORDERLINE FLAG (separate from the score): for each positive component you score here (focused_information_gathering, closed_loop_team_communication, orders_monitoring_quality, clinical_reasoning_documentation), include "borderline_up": true only when the attempt is a close call just below the next whole-point level: it meets the main requirement of the next level up, but one specific element of that level is missing, late, or weak. Otherwise "borderline_up": false. Use false when the score is already the component maximum or the component is null. This flag never changes the score, feedback, or evidence IDs.';
};

// A deduction is pulled toward zero by a lenient room (ceil) and pushed away from
// zero by a strict room (floor), as in the pre-2b2e379 implementation.
const scaleDeduction = (score: number | null, multiplier: number) => {
  if (score == null) return null;
  if (multiplier === 1) return score;
  const scaled = multiplier > 1 ? Math.ceil(score / multiplier) : Math.floor(score / multiplier);
  const normalized = clamp(scaled, -2, 0);
  return Object.is(normalized, -0) ? 0 : normalized;
};

// Returns a new canonical evaluation with the room modifier applied. Totals are
// recomputed by canonicalizeEvaluation, so they stay clamped and null-aware.
export const applyLeniencyToEvaluation = (
  evaluation: EvaluationScoringResponse,
  rawMultiplier: unknown,
): EvaluationScoringResponse => {
  const multiplier = normalizeLeniencyMultiplier(rawMultiplier);
  if (multiplier === 1) return evaluation;
  const c = evaluation.communication_breakdown;
  const m = evaluation.clinical_reasoning_breakdown;
  return canonicalizeEvaluation({
    ...evaluation,
    communication_breakdown: {
      focused_information_gathering: positiveFor(c.focused_information_gathering, 2, multiplier),
      closed_loop_team_communication: positiveFor(c.closed_loop_team_communication, 3, multiplier),
      efficiency_deduction: withScore(c.efficiency_deduction, scaleDeduction(c.efficiency_deduction.score, multiplier)),
    },
    mdm_breakdown: {
      orders_monitoring_quality: positiveFor(m.orders_monitoring_quality, 3, multiplier),
      clinical_reasoning_documentation: positiveFor(m.clinical_reasoning_documentation, 2, multiplier),
      safety_deduction: withScore(m.safety_deduction, scaleDeduction(m.safety_deduction.score, multiplier)),
    },
    clinical_reasoning_breakdown: {
      orders_monitoring_quality: positiveFor(m.orders_monitoring_quality, 3, multiplier),
      clinical_reasoning_documentation: positiveFor(m.clinical_reasoning_documentation, 2, multiplier),
      safety_deduction: withScore(m.safety_deduction, scaleDeduction(m.safety_deduction.score, multiplier)),
    },
  } as Partial<EvaluationScoringResponse>);
};
