import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';
import { resolvePinnedConversationPrompt } from '../_shared/conversation-prompt-config.ts';
import { resolveFailedConsultantRequestClaim } from '../_shared/consultant-request-claim.ts';
import {
  CONSULTANT_TRANSPORT_FUNCTION_VERSION,
  CONSULTANT_TRANSPORT_SCHEMA_VERSION,
  hashConsultantPayload,
  consultantPayloadMatches,
  validateConsultantTransportInput,
  type ConsultantAudience,
  type FrozenConsultantPayload,
} from '../_shared/consultant-transport.ts';

type ConsultantRequest = {
  audience?: unknown;
  specialty?: unknown;
  message?: unknown;
  clientRequestId?: unknown;
};
type Payload = {
  mode?: unknown;
  transportContractVersion?: unknown;
  assignmentId?: unknown;
  request?: ConsultantRequest;
};
type StoredRequest = {
  id: string;
  assignment_id: string;
  audience: ConsultantAudience | null;
  specialty: string;
  message: string | null;
  payload_hash: string | null;
  response: string | null;
  disposition: string | null;
  consult_order_id: string | null;
  status: string;
  lease_token: string | null;
  lease_expires_at: string | null;
};
type PersistedMessage = {
  id: string;
  role: 'student' | 'consultant';
  content: string;
  specialty: string | null;
  audience: ConsultantAudience | null;
  created_at: string;
  request_id: string | null;
  consult_order_id: string | null;
};

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) throw new Error('Missing Supabase service credentials');
const admin = createClient(url, serviceKey);
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const errorCode = (value: unknown) => record(value).code;

const readRequestMessages = async (requestId: string) => {
  const { data, error } = await admin
    .from('consultant_chat_messages')
    .select('id, role, content, specialty, audience, created_at, request_id, consult_order_id')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PersistedMessage[];
};

const responseFromStoredRequest = async (request: StoredRequest, idempotent = true) => {
  const messages = await readRequestMessages(request.id);
  const answer = messages.find((message) => message.role === 'consultant')?.content;
  if (!answer || messages.length < 2) {
    return json({
      error: 'Consultant request outcome is unresolved; retry the exact frozen message before editing or sending another request.',
      code: 'request_outcome_unresolved',
      requestId: request.id,
      retryable: true,
    }, 409);
  }
  return json({
    message: answer,
    messages,
    disposition: request.disposition,
    orderId: request.consult_order_id,
    requestId: request.id,
    idempotent,
  });
};

const findExistingRequest = async (assignmentId: string, clientRequestId: string) => {
  const { data, error } = await admin
    .from('consultant_requests')
    .select('id, assignment_id, audience, specialty, message, payload_hash, response, disposition, consult_order_id, status, lease_token, lease_expires_at')
    .eq('assignment_id', assignmentId)
    .eq('client_request_id', clientRequestId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as StoredRequest | null;
};

const findPendingThreadRequest = async (payload: FrozenConsultantPayload) => {
  const { data, error } = await admin
    .from('consultant_requests')
    .select('id, assignment_id, audience, specialty, message, payload_hash, response, disposition, consult_order_id, status, lease_token, lease_expires_at')
    .eq('assignment_id', payload.assignmentId)
    .eq('audience', payload.audience)
    .eq('specialty', payload.specialty)
    .eq('status', 'requested')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as StoredRequest | null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let requestIdForCleanup: string | null = null;
  let ownsRequestAttempt = false;
  let leaseToken: string | null = null;
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Authentication required' }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'Authentication required' }, 401);

    const payload = await req.json() as Payload;
    if (payload.mode === 'preflight') {
      const { data: schema, error: schemaError } = await admin.rpc('consultant_transport_preflight');
      if (schemaError || record(schema).schemaVersion !== CONSULTANT_TRANSPORT_SCHEMA_VERSION || record(schema).atomicPersistence !== true) return json({ error: 'Consultant transport schema or atomic persistence is not ready' }, 503);
      if (payload.transportContractVersion !== CONSULTANT_TRANSPORT_FUNCTION_VERSION) return json({ error: 'Consultant transport function version is incompatible' }, 409);
      return json({ ready: true, schemaVersion: CONSULTANT_TRANSPORT_SCHEMA_VERSION, functionVersion: CONSULTANT_TRANSPORT_FUNCTION_VERSION, atomicPersistence: true });
    }
    if (payload.mode === 'recover') {
      if (typeof payload.assignmentId !== 'string' || !payload.assignmentId) return json({ error: 'assignmentId is required for recovery' }, 400);
      const { data: assignment, error: assignmentError } = await admin.from('student_room_assignments').select('id, student_id').eq('id', payload.assignmentId).maybeSingle();
      if (assignmentError) throw assignmentError;
      if (!assignment || assignment.student_id !== auth.user.id) return json({ error: 'Assignment not found' }, 404);
      const { data: pending, error: pendingError } = await admin.from('consultant_requests')
        .select('id, client_request_id, audience, specialty, message, payload_snapshot, payload_hash, status, lease_expires_at')
        .eq('assignment_id', payload.assignmentId).eq('status', 'requested')
        .order('created_at', { ascending: true }).limit(10);
      if (pendingError) throw pendingError;
      return json({ requests: pending ?? [] });
    }
    if (payload.transportContractVersion !== CONSULTANT_TRANSPORT_FUNCTION_VERSION) return json({ error: 'Consultant transport function version is incompatible' }, 409);

    const parsed = validateConsultantTransportInput({ assignmentId: payload.assignmentId, ...payload.request });
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const { payload: frozenPayload, clientRequestId } = parsed;
    const payloadHash = await hashConsultantPayload(frozenPayload);

    const { data: assignment, error } = await admin.from('student_room_assignments').select('id, student_id, scenario_baseline, room:room_id(id, patient_id, school_id, consultant_response_prompt, emr_context, role, context)').eq('id', frozenPayload.assignmentId).maybeSingle();
    if (error) throw error;
    if (!assignment || assignment.student_id !== auth.user.id) return json({ error: 'Assignment not found' }, 404);
    const room = Array.isArray(assignment.room) ? assignment.room[0] : assignment.room;
    const roomRecord = record(room);
    const patientId = typeof roomRecord.patient_id === 'string' ? roomRecord.patient_id : null;
    const roomId = typeof roomRecord.id === 'number' ? roomRecord.id : null;
    if (!patientId || !roomId) return json({ error: 'This assignment has no linked patient chart' }, 409);

    const existingRequest = await findExistingRequest(frozenPayload.assignmentId, clientRequestId);
    let requestRecord: StoredRequest | null = existingRequest;
    if (existingRequest) {
      const storedPayload = {
        assignmentId: existingRequest.assignment_id,
        audience: existingRequest.audience,
        specialty: existingRequest.specialty,
        message: existingRequest.message,
      };
      if (!existingRequest.audience || !existingRequest.message || !consultantPayloadMatches({ ...storedPayload, audience: existingRequest.audience, message: existingRequest.message }, frozenPayload)) return json({ error: 'clientRequestId is already bound to a different assignment, audience, service, or exact message', code: 'idempotency_conflict', requestId: existingRequest.id }, 409);
      if (existingRequest.payload_hash && existingRequest.payload_hash !== payloadHash) return json({ error: 'clientRequestId payload hash does not match the frozen request', code: 'idempotency_conflict', requestId: existingRequest.id }, 409);
      if (existingRequest.status === 'answered' || existingRequest.status === 'assumes_care') return await responseFromStoredRequest(existingRequest);
      if (existingRequest.status === 'requested') {
        if (existingRequest.lease_expires_at && new Date(existingRequest.lease_expires_at).getTime() > Date.now()) return await responseFromStoredRequest(existingRequest, false);
        leaseToken = crypto.randomUUID();
        const { data: claimedRows, error: claimError } = await admin.from('consultant_requests')
          .update({ lease_token: leaseToken, lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString() })
          .eq('id', existingRequest.id).eq('status', 'requested')
          .or(`lease_expires_at.is.null,lease_expires_at.lte.${new Date().toISOString()}`)
          .select('id, assignment_id, audience, specialty, message, payload_hash, response, disposition, consult_order_id, status, lease_token, lease_expires_at');
        if (claimError) throw claimError;
        const claim = resolveFailedConsultantRequestClaim(claimedRows ?? []);
        if (!claim.claimed) return await responseFromStoredRequest(await findExistingRequest(frozenPayload.assignmentId, clientRequestId) as StoredRequest, false);
        requestRecord = claim.row as StoredRequest;
        requestIdForCleanup = requestRecord.id;
        ownsRequestAttempt = true;
      }
      if (existingRequest.status === 'failed') {
        leaseToken = crypto.randomUUID();
        const { data: claimedRows, error: reclaimError } = await admin
          .from('consultant_requests')
          .update({ status: 'requested', response: null, answered_at: null, lease_token: leaseToken, lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString() })
          .eq('id', existingRequest.id)
          .eq('status', 'failed')
          .select('id, assignment_id, audience, specialty, message, payload_hash, response, disposition, consult_order_id, status, lease_token, lease_expires_at');
        if (reclaimError) throw reclaimError;
        const claim = resolveFailedConsultantRequestClaim(claimedRows ?? []);
        if (claim.claimed) {
          requestRecord = claim.row as StoredRequest;
          requestIdForCleanup = requestRecord.id;
          ownsRequestAttempt = true;
        } else {
          const currentRequest = await findExistingRequest(frozenPayload.assignmentId, clientRequestId);
          if (!currentRequest) return json({ error: 'Consultant request outcome is unresolved; retry the exact frozen message.', code: 'request_outcome_unresolved', retryable: true }, 409);
          return await responseFromStoredRequest(currentRequest, false);
        }
      }
    }

    if (!existingRequest) {
      const pending = await findPendingThreadRequest(frozenPayload);
      if (pending) return json({ error: 'A prior consultant request outcome is unresolved; retry its exact frozen message before editing or sending another request', code: 'request_outcome_unresolved', requestId: pending.id, retryable: true }, 409);
    }

    const behavior = resolvePinnedConversationPrompt(roomRecord, assignment.scenario_baseline, 'consultant');
    if (!behavior) return json({ error: 'Consultant Conversation Prompt not configured. Ask an administrator to configure this room.' }, 409);

    if (!requestRecord) {
      leaseToken = leaseToken ?? crypto.randomUUID();
      const { data: inserted, error: requestError } = await admin.from('consultant_requests').insert({
        assignment_id: frozenPayload.assignmentId,
        patient_id: patientId,
        room_id: roomId,
        specialty: frozenPayload.specialty,
        audience: frozenPayload.audience,
        message: frozenPayload.message,
        payload_snapshot: frozenPayload,
        payload_hash: payloadHash,
        summary: null,
        clinical_question: null,
        reason: null,
        urgency: null,
        client_request_id: clientRequestId,
        status: 'requested',
        lease_token: leaseToken,
        lease_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      }).select('id, assignment_id, audience, specialty, message, payload_hash, response, disposition, consult_order_id, status, lease_token, lease_expires_at').single();
      if (requestError && errorCode(requestError) === '23505') {
        const raced = await findExistingRequest(frozenPayload.assignmentId, clientRequestId);
        if (!raced) throw requestError;
        if (raced.assignment_id !== frozenPayload.assignmentId || raced.audience !== frozenPayload.audience || raced.specialty !== frozenPayload.specialty || raced.message !== frozenPayload.message) return json({ error: 'clientRequestId is already bound to a different frozen request', code: 'idempotency_conflict', requestId: raced.id }, 409);
        return await responseFromStoredRequest(raced, false);
      }
      if (requestError) throw requestError;
      requestRecord = inserted as StoredRequest;
      requestIdForCleanup = requestRecord.id;
      ownsRequestAttempt = true;
    }
    if (!requestRecord) throw new Error('Consultant request was not persisted');

    const { data: priorMessages, error: priorMessagesError } = await admin.from('consultant_chat_messages').select('role, content').eq('assignment_id', frozenPayload.assignmentId).eq('audience', frozenPayload.audience).eq('specialty', frozenPayload.specialty).order('created_at', { ascending: true });
    if (priorMessagesError) throw priorMessagesError;
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
    const completion = await openai.chat.completions.create({
      model: getOpenAIModel('chat'), max_completion_tokens: 500, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: behavior },
        { role: 'system', content: 'Technical transport contract: return a JSON object with message (string) and disposition (routine_review or assumes_care). Do not add any other fields.' },
        { role: 'user', content: JSON.stringify({ audience: frozenPayload.audience, specialty: frozenPayload.specialty, thread: [...(priorMessages ?? []), { role: 'student', content: frozenPayload.message }] }) },
      ],
    });
    const parsedAnswer = record(JSON.parse(completion.choices[0]?.message?.content ?? '{}'));
    const answer = typeof parsedAnswer.message === 'string' ? parsedAnswer.message.trim() : '';
    if (!answer) throw new Error('Consultant response was empty');
    const disposition = parsedAnswer.disposition === 'assumes_care' ? 'assumes_care' : 'routine_review';
    const { data: persisted, error: persistError } = await admin.rpc('persist_consultant_response_v2', {
      p_student_id: auth.user.id,
      p_assignment_id: frozenPayload.assignmentId,
      p_client_request_id: clientRequestId,
      p_patient_id: patientId,
      p_room_id: roomId,
      p_audience: frozenPayload.audience,
      p_specialty: frozenPayload.specialty,
      p_message: frozenPayload.message,
      p_payload_hash: payloadHash,
      p_response: answer,
      p_disposition: disposition,
      p_lease_token: leaseToken,
    });
    if (persistError) throw persistError;
    const persistedRow = Array.isArray(persisted) ? persisted[0] as Record<string, unknown> | undefined : undefined;
    if (!persistedRow?.result_request_id) throw new Error('Consultant persistence returned no stored request');
    const messages = await readRequestMessages(requestRecord.id);
    return json({ message: messages.find((message) => message.role === 'consultant')?.content ?? answer, messages, disposition: persistedRow.result_disposition, orderId: persistedRow.result_order_id, requestId: requestRecord.id });
  } catch (error) {
    // Never compensate-delete after finalize. A read-back/network failure must
    // leave the committed outcome replayable by the same frozen request ID.
    if (ownsRequestAttempt && requestIdForCleanup) {
      await admin.from('consultant_requests').update({ status: 'failed', lease_token: null, lease_expires_at: null }).eq('id', requestIdForCleanup).eq('status', 'requested').eq('lease_token', leaseToken);
    }
    return json({ error: error instanceof Error ? error.message : 'Consultant response failed' }, 500);
  }
});
