export const NEW_FORMAT_EVALUATOR_SPEC_VERSION = 'new-format-faculty-study-v1';
export const NEW_FORMAT_EXPECTED_MODEL = 'gpt-6-luna';
export const GENERATOR_REVISION_BINDING_KEY = 'GENERATE_FEEDBACK_REVISION';

export const NEW_FORMAT_EVALUATOR_INSTRUCTION = `Evaluate only observable evidence from the current attempt after its first nurse page. Report exactly two domains: Clinical Reasoning and Communication. Score each domain from 0-5 by summing its three components and clamping the sum to 0-5. Communication is Focused Information Gathering (0-2) + Closed-Loop Team Communication (0-3) + context-aware Efficiency Deduction (-2 to 0). Clinical Reasoning is Orders/Monitoring Quality (0-3) + Clinical Reasoning/Documentation (0-2) + Safety Deduction (-2 to 0). Do not score message count, question count, message timing, or missing nurse chat. Give equivalent credit to a clinically coherent bedside-first path when linked learner-authored bedside, patient, chart, or team evidence is captured. Efficiency deductions require a case-specific observed communication problem. Apply a safety deduction only for an actual unsafe learner action or order, using only the most severe applicable deduction, and report the separate safety result. If evidence is missing, say not observed or insufficient evidence and do not invent a failure. Do not attribute a physical examination or physical findings to the learner; state only what the learner recorded or communicated. Do not return a Professionalism score, an Overall score, a global multiplier, or any other score.`;

type ScoreAnchors = Readonly<Record<number, string>>;
type ComponentAnchor = Readonly<{
  range: readonly [number, number];
  scores: ScoreAnchors;
}>;

export const NEW_FORMAT_COMPONENT_ANCHORS: Readonly<Record<string, ComponentAnchor>> = Object.freeze({
  focused_information_gathering: Object.freeze({
    range: [0, 2] as const,
    scores: Object.freeze({
      0: 'No learner-authored information gathering is captured; do not infer it from vitals, orders, notes, or nurse-chat absence.',
      1: 'Some relevant learner-authored information gathering is captured, but it is incomplete, unfocused, or only partly connected to the case.',
      2: 'Focused learner-authored information gathering captures the key case-relevant information or an equivalent coherent bedside path.',
    }),
  }),
  closed_loop_team_communication: Object.freeze({
    range: [0, 3] as const,
    scores: Object.freeze({
      0: 'No linked learner-authored team, patient, chart, or bedside communication is captured.',
      1: 'A relevant learner-authored communication or escalation is captured, but the message or handoff is incomplete.',
      2: 'The learner communicates a relevant concern or plan and establishes part of the needed response loop.',
      3: 'The learner gives clear, case-relevant communication and closes the loop with the team, patient, chart, or bedside action.',
    }),
  }),
  efficiency_deduction: Object.freeze({
    range: [-2, 0] as const,
    scores: Object.freeze({
      '-2': 'A severe, case-specific observed communication inefficiency materially delays or obscures needed care.',
      '-1': 'A limited, case-specific observed communication inefficiency creates avoidable friction or delay.',
      0: 'No case-specific observed communication inefficiency supports a deduction; counts, timing, and missing nurse chat do not qualify.',
    }),
  }),
  orders_monitoring_quality: Object.freeze({
    range: [0, 3] as const,
    scores: Object.freeze({
      0: 'No relevant learner orders, monitoring, results, or reassessment are captured.',
      1: 'A relevant order, monitoring step, result review, or reassessment is captured but is limited or incomplete.',
      2: 'Orders and monitoring are substantially aligned with the case and include meaningful follow-through.',
      3: 'Orders, monitoring, results, and reassessment form a timely, coherent, case-appropriate care path.',
    }),
  }),
  clinical_reasoning_documentation: Object.freeze({
    range: [0, 2] as const,
    scores: Object.freeze({
      0: 'No learner-authored clinical reasoning or documentation is captured.',
      1: 'Some learner-authored reasoning or documentation is captured, but the rationale or connection to evidence is incomplete.',
      2: 'Learner-authored reasoning and documentation clearly connect observed evidence to a coherent clinical plan.',
    }),
  }),
  safety_deduction: Object.freeze({
    range: [-2, 0] as const,
    scores: Object.freeze({
      '-2': 'One actual severe unsafe learner action or order is captured; apply only this most severe applicable deduction.',
      '-1': 'One actual unsafe learner action or order is captured and warrants a limited safety deduction.',
      0: 'No actual unsafe learner action or order is captured; concerns, omissions, or hypothetical risks alone do not qualify.',
    }),
  }),
});

export const NEW_FORMAT_EVALUATOR_SPEC = Object.freeze({
  version: NEW_FORMAT_EVALUATOR_SPEC_VERSION,
  expected_model: NEW_FORMAT_EXPECTED_MODEL,
  generator_revision_binding_key: GENERATOR_REVISION_BINDING_KEY,
  instruction: NEW_FORMAT_EVALUATOR_INSTRUCTION,
  component_anchors: NEW_FORMAT_COMPONENT_ANCHORS,
});

/** Stable review hash input; hash this exact UTF-8 string before activation. */
/** Canonical JSON for JSONB values: object key order is not semantic. */
export const stableCanonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
};

export const NEW_FORMAT_EVALUATOR_SPEC_HASH_INPUT = [
  NEW_FORMAT_EVALUATOR_SPEC_VERSION,
  NEW_FORMAT_EXPECTED_MODEL,
  GENERATOR_REVISION_BINDING_KEY,
  NEW_FORMAT_EVALUATOR_INSTRUCTION,
  // Keep the reviewed public hash immutable; stableCanonicalJson is used for
  // semantic JSONB comparisons, while this exact input remains the published
  // provenance string for the approved spec.
  JSON.stringify(NEW_FORMAT_COMPONENT_ANCHORS),
].join('\n');
export const NEW_FORMAT_EVALUATOR_SPEC_SHA256 = 'f54980a6c1dcea628d6ed22540db7672f33306d5a3c0a98cf3acaa32a091b9fe';

export const NEW_FORMAT_STUDY_ONLY_DEPENDENCIES = Object.freeze({
  isolated_tables: ['faculty_study_batches', 'faculty_study_results'],
  evaluator_config: 'versioned feedback_evaluator_configs with immutable prompt/anchors provenance',
  generator_revision: `study-enabled requires ${GENERATOR_REVISION_BINDING_KEY}`,
  lease: 'service-role-only serialized lease/reclaim RPC',
  learner_mutation: 'none; existing learner feedback, grades, assignments, and history remain untouched',
});

export type EvaluatorGenerationMode = 'study-enabled' | 'preflight-only';
export type EnvironmentReader = { get(name: string): string | undefined };

/** Generation is opt-in; every enabled path must carry an explicit revision binding. */
export const resolveGeneratorRevisionBinding = (
  mode: EvaluatorGenerationMode,
  environment: EnvironmentReader,
): string | null => {
  if (mode !== 'study-enabled') return null;
  const revision = environment.get(GENERATOR_REVISION_BINDING_KEY)?.trim();
  if (!revision) throw new Error('GENERATOR_REVISION_UNVERIFIED');
  return revision;
};

export type NewFormatEvaluatorBinding = {
  prompt_version?: unknown;
  prompt_text?: unknown;
  evaluator_spec_version?: unknown;
  evaluator_spec_hash?: unknown;
  component_anchors?: unknown;
  expected_model?: unknown;
  generator_revision?: unknown;
};

const exactJson = (value: unknown) => stableCanonicalJson(value) === stableCanonicalJson(NEW_FORMAT_COMPONENT_ANCHORS);

/**
 * The study-enabled path is allowed to run only against the reviewed spec.
 * Keep this pure so callers can validate before their first isolated-table write
 * or model request, and so synthetic tests never need a database or model.
 */
export const assertReviewedNewFormatBinding = (binding: NewFormatEvaluatorBinding) => {
  if (binding.prompt_version !== NEW_FORMAT_EVALUATOR_SPEC_VERSION) throw new Error('NEW_FORMAT_PROMPT_VERSION_MISMATCH');
  if (binding.prompt_text !== NEW_FORMAT_EVALUATOR_INSTRUCTION) throw new Error('NEW_FORMAT_PROMPT_MISMATCH');
  if (binding.evaluator_spec_version !== NEW_FORMAT_EVALUATOR_SPEC_VERSION) throw new Error('NEW_FORMAT_SPEC_VERSION_MISMATCH');
  if (binding.evaluator_spec_hash !== NEW_FORMAT_EVALUATOR_SPEC_SHA256) throw new Error('NEW_FORMAT_SPEC_HASH_MISMATCH');
  if (!exactJson(binding.component_anchors)) throw new Error('NEW_FORMAT_COMPONENT_ANCHORS_MISMATCH');
  if (binding.expected_model !== NEW_FORMAT_EXPECTED_MODEL) throw new Error('NEW_FORMAT_MODEL_MISMATCH');
  if (typeof binding.generator_revision !== 'string' || binding.generator_revision.trim() === '') throw new Error('GENERATOR_REVISION_UNVERIFIED');
  return true;
};
