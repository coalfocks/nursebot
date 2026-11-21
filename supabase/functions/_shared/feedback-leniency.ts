// Room leniency scales positive components and the communication efficiency deduction.
// Safety is an independent rubric finding: preserve its deduction, level and evidence.
// Scaling only its numeric deduction would manufacture a safety-level contradiction.
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

const scalePositive = (score: number | null, max: number, multiplier: number) =>
  score == null ? null : clamp(Math.round(score * multiplier), 0, max);

// A deduction is pulled toward zero by a lenient room (ceil) and pushed away from
// zero by a strict room (floor), as in the pre-2b2e379 implementation.
const scaleDeduction = (score: number | null, multiplier: number) => {
  if (score == null) return null;
  if (multiplier === 1) return score;
  const scaled = multiplier > 1 ? Math.ceil(score / multiplier) : Math.floor(score / multiplier);
  const normalized = clamp(scaled, -2, 0);
  return Object.is(normalized, -0) ? 0 : normalized;
};

const withScore = (component: ScoredComponent, score: number | null): ScoredComponent => ({ ...component, score });

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
      focused_information_gathering: withScore(c.focused_information_gathering, scalePositive(c.focused_information_gathering.score, 2, multiplier)),
      closed_loop_team_communication: withScore(c.closed_loop_team_communication, scalePositive(c.closed_loop_team_communication.score, 3, multiplier)),
      efficiency_deduction: withScore(c.efficiency_deduction, scaleDeduction(c.efficiency_deduction.score, multiplier)),
    },
    mdm_breakdown: {
      orders_monitoring_quality: withScore(m.orders_monitoring_quality, scalePositive(m.orders_monitoring_quality.score, 3, multiplier)),
      clinical_reasoning_documentation: withScore(m.clinical_reasoning_documentation, scalePositive(m.clinical_reasoning_documentation.score, 2, multiplier)),
      safety_deduction: m.safety_deduction,
    },
    clinical_reasoning_breakdown: {
      orders_monitoring_quality: withScore(m.orders_monitoring_quality, scalePositive(m.orders_monitoring_quality.score, 3, multiplier)),
      clinical_reasoning_documentation: withScore(m.clinical_reasoning_documentation, scalePositive(m.clinical_reasoning_documentation.score, 2, multiplier)),
      safety_deduction: m.safety_deduction,
    },
  } as Partial<EvaluationScoringResponse>);
};
