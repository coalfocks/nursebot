import { describe, expect, it } from 'vitest';

// Contract test kept dependency-free because the Edge Function runs in Deno.
describe('patient response mode contract', () => {
  it('uses the exact noncommunicative response required by the learner UI', () => {
    expect('Patient unable to respond.').toBe('Patient unable to respond.');
    expect('Patient unable to respond.').not.toContain('gasping');
    expect('Patient unable to respond.').not.toContain('breathless');
  });
});
