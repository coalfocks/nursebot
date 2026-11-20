import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/generate-feedback/index.ts', 'utf8');

describe('generate-feedback wiring', () => {
  it('appends the context block to the user message, never the evaluator system prompt', () => {
    expect(source).toContain('${feedbackContext.text}');
    expect(source).toContain("{ role: 'system', content: EVALUATION_SYSTEM_PROMPT }");
    expect(source).not.toMatch(/EVALUATION_SYSTEM_PROMPT\s*\+|EVALUATION_SYSTEM_PROMPT\}\$\{feedbackContext/);
  });
  it('records context provenance (id, hash, rendered hash) with the model and evaluator prompt hash', () => {
    for (const field of ['context_block_id', 'context_block_sha256', 'context_rendered_sha256', 'prompt_sha256: NURSE_ALTHEA_SIMULATION_PROMPT_SHA256', 'model: PINNED_FEEDBACK_MODEL']) expect(source).toContain(field);
  });
  it('uses the pinned scenario baseline over live room text for the context', () => {
    expect(source).toContain('{ ...room, ...baseline }');
  });
  it('compare mode returns before any write to the saved result and skips saved-score reuse', () => {
    const compareReturn = source.indexOf("return { versionId: compareVersionId, promptVersion: commentPromptVersion");
    const officialRunInsert = source.indexOf("insert({ ...provenance, technical_incomplete: false");
    expect(compareReturn).toBeGreaterThan(0);
    expect(compareReturn).toBeLessThan(officialRunInsert);
    expect(source).toContain('!forceRegrade && !compareVersionId');
  });
  it('scoped modes do not mark the assignment failed from the outer catch, and the worker stays detached', () => {
    expect(source).toContain('!commentsOnly && !requestMode');
    expect(source).toContain('EdgeRuntime');
  });
});
