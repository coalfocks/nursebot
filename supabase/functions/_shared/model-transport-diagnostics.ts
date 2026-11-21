export type ModelTransportAttempt = {
  section: string; started_at_ms: number; elapsed_ms?: number;
  status: 'pending' | 'received' | 'error'; http_status?: number;
  response_bytes?: number; content_characters?: number; content_bytes?: number;
  finish_reason?: string | null; raw_candidate?: string | null; error?: string;
};
/** Observe each SDK transport attempt (including retries), without modifying requests or responses. */
export const diagnosticFetch = (attempts: ModelTransportAttempt[], transport: typeof fetch = fetch): typeof fetch => async (input, init) => {
  let section = 'unknown';
  try {
    const body = JSON.parse(String(init?.body));
    const messages = body.messages.map((m: { content: string }) => m.content).join('\n');
    section = messages.includes('MEDICAL DECISION-MAKING SECTION:') ? 'medical_decision_making'
      : messages.includes('COMMUNICATION SECTION:') ? 'communication'
      : messages.includes('Repair the candidate') ? 'commentary_repair' : 'commentary_initial';
  } catch { /* Diagnostic classification must never affect transport. */ }
  const attempt: ModelTransportAttempt = { section, started_at_ms: Date.now(), status: 'pending' };
  attempts.push(attempt);
  try {
    const response = await transport(input, init);
    attempt.http_status = response.status;
    attempt.status = 'received';
    try {
      const text = await response.clone().text();
      attempt.response_bytes = new TextEncoder().encode(text).length;
      const parsed = JSON.parse(text);
      const choice = parsed.choices?.[0];
      attempt.finish_reason = choice?.finish_reason ?? null;
      attempt.raw_candidate = choice?.message?.content ?? null;
      if (typeof attempt.raw_candidate === 'string') {
        attempt.content_characters = attempt.raw_candidate.length;
        attempt.content_bytes = new TextEncoder().encode(attempt.raw_candidate).length;
      }
      if (!response.ok) attempt.error = parsed.error?.message ?? `HTTP ${response.status}`;
    } catch (error) { attempt.error = `Diagnostic response read: ${error instanceof Error ? error.message : String(error)}`; }
    return response;
  } catch (error) {
    attempt.status = 'error';
    attempt.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally { attempt.elapsed_ms = Date.now() - attempt.started_at_ms; }
};
