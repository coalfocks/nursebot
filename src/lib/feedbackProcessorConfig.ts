/**
 * Opt-in configuration for the background FeedbackProcessor.
 *
 * Disabled unless VITE_FEEDBACK_PROCESSOR_ENABLED is exactly "true".
 * VITE_FEEDBACK_PROCESSOR_ASSIGNMENT_IDS (comma-separated assignment UUIDs) restricts processing to those
 * assignments only, e.g. a synthetic QA attempt. When the variable is set but yields no valid IDs, nothing runs.
 * When it is unset and the processor is enabled, all completed+pending assignments are processed (legacy scope).
 */
export type FeedbackProcessorConfig = {
  enabled: boolean;
  /** null = unrestricted (all pending completed assignments in scope); [] = process nothing. */
  assignmentIds: string[] | null;
};

type ProcessorEnv = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const resolveFeedbackProcessorConfig = (env: ProcessorEnv): FeedbackProcessorConfig => {
  const enabled = typeof env.VITE_FEEDBACK_PROCESSOR_ENABLED === 'string'
    && env.VITE_FEEDBACK_PROCESSOR_ENABLED.trim() === 'true';
  const raw = env.VITE_FEEDBACK_PROCESSOR_ASSIGNMENT_IDS;
  if (typeof raw !== 'string') return { enabled, assignmentIds: null };
  const assignmentIds = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => UUID_PATTERN.test(value));
  return { enabled, assignmentIds: [...new Set(assignmentIds)] };
};

export const feedbackProcessorConfig: FeedbackProcessorConfig = resolveFeedbackProcessorConfig(import.meta.env);
