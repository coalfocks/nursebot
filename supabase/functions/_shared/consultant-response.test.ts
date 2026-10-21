import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { ConsultantModelOutputError, parseConsultantCompletion } from './consultant-response.ts';

Deno.test('parses a complete structured consultant response', () => {
  assertEquals(parseConsultantCompletion({ choices: [{ finish_reason: 'stop', message: { content: '{"message":"Reassess now.","disposition":"routine_review"}' } }] }), {
    answer: 'Reassess now.', disposition: 'routine_review', finishReason: 'stop', outputLength: '{"message":"Reassess now.","disposition":"routine_review"}'.length,
  });
});

Deno.test('reports finish reason and output length for truncated JSON', () => {
  const error = assertThrows(() => parseConsultantCompletion({ choices: [{ finish_reason: 'length', message: { content: '{"message":"Reassess' } }] }), ConsultantModelOutputError);
  assertEquals({ code: error.code, finishReason: error.finishReason, outputLength: error.outputLength }, { code: 'CONSULTANT_MODEL_OUTPUT_INVALID', finishReason: 'length', outputLength: '{"message":"Reassess'.length });
});
