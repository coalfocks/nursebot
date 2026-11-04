import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canCreateConsultantWrite, shouldCleanupConsultantArtifacts } from './guards.ts';

Deno.test('blocks consultant writes after assignment completion', () => {
  assertEquals(canCreateConsultantWrite('completed'), false);
  assertEquals(canCreateConsultantWrite('in_progress'), true);
  assertEquals(canCreateConsultantWrite('bedside'), true);
});

Deno.test('cleans only artifacts belonging to a newly created request', () => {
  assertEquals(shouldCleanupConsultantArtifacts(true), true);
  assertEquals(shouldCleanupConsultantArtifacts(false), false);
});
