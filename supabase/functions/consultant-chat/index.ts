import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';
import { resolvePinnedConversationPrompt } from '../_shared/conversation-prompt-config.ts';
import { buildConsultantOrderLookup, decideConsultantOrderPersistence } from '../_shared/consultant-order.ts';
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
    .select('id, assignment_id, audience, specialty, message, payload_hash, response, disposition, consult_order_id, status')
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
    .select('id, assignment_id, audience, specialty, message, payload_hash, response, disposition, consult_order_id, status')
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

const findOrCreateConsultOrder = async ({ assignmentId, patientId, roomId, schoolId, audience, specialty }: FrozenConsultPayload & { patientId: string; roomId: number; schoolId: string | null }) => {
  const fields = 'id';
  const lookup = buildConsultantOrderLookup({ assignmentId, audience, specialty });
  const queryExisting = async () => {
    const { data, error } = await admin
      .from('medical_orders')
      .select(fields)
      .eq('assignment_id', lookup.assignmentId)
      .eq('consult_audience', lookup.audience)
      .eq('consult_service', lookup.specialty)
      .eq('category', lookup.category)
      .eq('override_scope', lookup.overrideScope)
      .eq('status', lookup.status)
      .is('deleted_at', lookup.deletedAt)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as { id: string } | null;
  };

  const existing = await queryExisting();
  const existingDecision = decideConsultantOrderPersistence(existing);
  if (existingDecision.action === 'reuse') return { order: existingDecision.order, created: false };

  const { data, error } = await admin.from('medical_orders').insert({
    patient_id: patientId,
    assignment_id: assignmentId,
    room_id: roomId,
    school_id: schoolId,
    override_scope: 'assignment',
    category: 'Consult',
    order_name: `Consult: ${specialty}`,
    priority: null,
    status: 'Active',
    ordered_by: 'Student',
    order_time: new Date().toISOString(),
    instructions: null,
    consult_audience: audience,
    consult_service: specialty,
  }).select(fields).single();
  if (!error && data) return { order: data as { id: string }, created: true };
  if (errorCode(error) !== '23505') throw error;
  const raced = await queryExisting();
  const racedDecision = decideConsultantOrderPersistence(raced);
  if (racedDecision.action === 'create') throw error;
  return { order: racedDecision.order, created: false };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let requestIdForCleanup: string | null = null;
  let createdOrderId: string | null = null;
  let ownsRequestAttempt = false;
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Authentication required' }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'Authentication required' }, 401);

    const payload = await req.json() as Payload;
    if (payload.mode === 'preflight') {
      const { data: schema, error: schemaError } = await admin.rpc('consultant_transport_preflight');
      if (schemaError || record(schema).schemaVersion !== CONSULTANT_TRANSPORT_SCHEMA_VERSION) return json({ error: 'Consultant transport schema is not ready' }, 503);
      if (payload.transportContractVersion !== CONSULTANT_TRANSPORT_FUNCTION_VERSION) return json({ error: 'Consultant transport function version is incompatible' }, 409);
      return json({ ready: true, schemaVersion: CONSULTANT_TRANSPORT_SCHEMA_VERSION, functionVersion: CONSULTANT_TRANSPORT_FUNCTION_VERSION, atomicPersistence: 'separate_dependency' });
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
      if (existingRequest.status === 'requested') return await responseFromStoredRequest(existingRequest, false);
      if (existingRequest.status === 'failed') {
        const { data: claimedRows, error: reclaimError } = await admin
          .from('consultant_requests')
          .update({ status: 'requested', response: null, answered_at: null })
          .eq('id', existingRequest.id)
          .eq('status', 'failed')
          .select('id, assignment_id, audience, specialty, message, payload_hash, response, disposition, consult_order_id, status');
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
      }).select('id, assignment_id, audience, specialty, message, payload_hash, response, disposition, consult_order_id, status').single();
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
    const orderResult = await findOrCreateConsultOrder({ ...frozenPayload, patientId, roomId, schoolId: typeof roomRecord.school_id === 'string' ? roomRecord.school_id : null });
    if (orderResult.created) createdOrderId = orderResult.order.id;
    const { error: messageError } = await admin.from('consultant_chat_messages').insert([
      { assignment_id: frozenPayload.assignmentId, request_id: requestRecord.id, role: 'student', content: frozenPayload.message, specialty: frozenPayload.specialty, audience: frozenPayload.audience, urgency: null, consult_order_id: orderResult.order.id },
      { assignment_id: frozenPayload.assignmentId, request_id: requestRecord.id, role: 'consultant', content: answer, specialty: frozenPayload.specialty, audience: frozenPayload.audience, urgency: null, consult_order_id: orderResult.order.id },
    ]);
    if (messageError) throw messageError;
    const persistedStatus = disposition === 'assumes_care' ? 'assumes_care' : 'answered';
    const { error: updateError } = await admin.from('consultant_requests').update({ response: answer, disposition, consult_order_id: orderResult.order.id, status: persistedStatus, answered_at: new Date().toISOString() }).eq('id', requestRecord.id).eq('status', 'requested');
    if (updateError) throw updateError;
    const messages = await readRequestMessages(requestRecord.id);
    return json({ message: messages.find((message) => message.role === 'consultant')?.content ?? answer, messages, disposition, orderId: orderResult.order.id, requestId: requestRecord.id });
  } catch (error) {
    // Atomic request/order/message persistence is intentionally not claimed here.
    // Until the separate transaction/RPC dependency is delivered, compensate
    // only for artifacts owned by this invocation.
    if (ownsRequestAttempt && requestIdForCleanup) {
      await admin.from('consultant_chat_messages').delete().eq('request_id', requestIdForCleanup);
      if (createdOrderId) await admin.from('medical_orders').delete().eq('id', createdOrderId);
      await admin.from('consultant_requests').update({ status: 'failed' }).eq('id', requestIdForCleanup).eq('status', 'requested');
    }
    return json({ error: error instanceof Error ? error.message : 'Consultant response failed' }, 500);
  }
});
