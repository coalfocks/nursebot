// generate-feedback is pinned to the model it effectively ran on in production (v75): no OPENAI_MODEL or
// OPENAI_MODEL_GENERATE_FEEDBACK secret was set, so the code default in openai-model.ts applied.
// Pinning keeps the model identical across this release and removes silent env-override drift.
export const PINNED_FEEDBACK_MODEL = 'gpt-6-luna';
