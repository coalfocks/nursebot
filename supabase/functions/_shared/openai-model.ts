export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';

export type AIWorkflow =
  | 'chat'
  | 'patient_chat'
  | 'lab_results'
  | 'vitals_generator'
  | 'imaging_results'
  | 'generate_case_package'
  | 'generate_feedback';

const workflowEnvironmentKey = (workflow: AIWorkflow) =>
  `OPENAI_MODEL_${workflow.toUpperCase()}`;

/** Resolve a model per workflow, with one optional global override as a bridge. */
export const getOpenAIModel = (workflow: AIWorkflow): string =>
  Deno.env.get(workflowEnvironmentKey(workflow))?.trim() ||
  Deno.env.get('OPENAI_MODEL')?.trim() ||
  DEFAULT_OPENAI_MODEL;

// Kept for older functions/importers while they migrate to explicit workflows.
export const OPENAI_MODEL = DEFAULT_OPENAI_MODEL;
