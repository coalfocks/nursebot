import { diagnosticFetch, type ModelTransportAttempt } from './model-transport-diagnostics.ts';
const assert = (v: unknown) => { if (!v) throw new Error('assertion failed'); };
Deno.test('preserves exact body, response and empty length-limited metadata', async () => {
  const attempts: ModelTransportAttempt[] = [];
  const body = JSON.stringify({ messages: [{ content: 'MEDICAL DECISION-MAKING SECTION:' }] });
  const raw = JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '' } }] });
  const wrapped = diagnosticFetch(attempts, (async (_i, init) => { assert(init?.body === body); return new Response(raw); }) as typeof fetch);
  assert(await (await wrapped('https://example.com', { body })).text() === raw);
  assert(attempts[0].section === 'medical_decision_making');
  assert(attempts[0].finish_reason === 'length' && attempts[0].content_bytes === 0);
});
Deno.test('captures HTTP retries as separate attempts and preserves malformed response', async () => {
  const attempts: ModelTransportAttempt[] = [];
  const wrapped = diagnosticFetch(attempts, (async () => new Response('broken', { status: 502 })) as typeof fetch);
  for (let i = 0; i < 2; i++) assert(await (await wrapped('https://example.com')).text() === 'broken');
  assert(attempts.length === 2 && attempts.every(a => a.http_status === 502 && a.response_bytes === 6));
});
Deno.test('captures cancellation and rethrows same error', async () => {
  const attempts: ModelTransportAttempt[] = []; const error = new Error('cancelled');
  try { await diagnosticFetch(attempts, (async () => { throw error; }) as typeof fetch)('https://example.com'); }
  catch (caught) { assert(caught === error); }
  assert(attempts[0].status === 'error' && attempts[0].error === 'cancelled');
});
