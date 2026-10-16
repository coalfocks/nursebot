import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';
import { resolvePinnedConversationPrompt } from '../_shared/conversation-prompt-config.ts';

type ConsultantRequest = {
  specialty?: string;
  summary?: string;
  clinicalQuestion?: string;
  reason?: string;
  urgency?: 'routine' | 'urgent' | 'emergent';
  clientRequestId?: string;
};
type Payload = { assignmentId?: string; request?: ConsultantRequest };
const SPECIALTIES = new Set([
  'Attending', 'Medicine', 'Surgery', 'Pediatrics', 'OB/GYN', 'Cardiology', 'ICU', 'Neurology', 'Nephrology', 'Infectious Disease',
  'Orthopedics', 'ENT', 'Anesthesiology', 'Endocrinology', 'Hematology', 'Toxicology', 'Pediatric Hepatology', 'Gastroenterology',
  'Pulmonology', 'Psychiatry', 'Dermatology', 'Urology', 'Oncology', 'Hospitalist', 'Pediatric Cardiology', 'Pediatric Neurology',
  'Pediatric Surgery', 'Pediatric Infectious Disease', 'Pediatric Pulmonology', 'Pediatric Nephrology', 'Pediatric Gastroenterology',
  'Pediatric Hematology/Oncology', 'Pediatric Critical Care', 'Pediatric Emergency Medicine',
]);
const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) throw new Error('Missing Supabase service credentials');
const admin = createClient(url, serviceKey);
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let createdRequestId: string | null = null;
  let createdOrderId: string | null = null;
  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Authentication required' }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'Authentication required' }, 401);
    const payload = await req.json() as Payload;
    const request = payload.request ?? {};
    const specialty = request.specialty?.trim() ?? '';
    const summary = request.summary?.trim() ?? '';
    const clinicalQuestion = request.clinicalQuestion?.trim() ?? '';
    const reason = request.reason?.trim() ?? '';
    const urgency = request.urgency ?? 'routine';
    if (!payload.assignmentId || !SPECIALTIES.has(specialty) || !summary || !clinicalQuestion || !reason || !request.clientRequestId || !['routine', 'urgent', 'emergent'].includes(urgency)) {
      return json({ error: 'Specialty, summary, clinical question, reason, urgency, and request id are required' }, 400);
    }
    if ([summary, clinicalQuestion, reason].some((value) => value.length > 1200)) return json({ error: 'Consult fields must be 1,200 characters or fewer' }, 400);

    const { data: assignment, error } = await admin.from('student_room_assignments').select('id, student_id, scenario_baseline, room:room_id(id, patient_id, school_id, consultant_response_prompt, emr_context, role, context)').eq('id', payload.assignmentId).maybeSingle();
    if (error) throw error;
    if (!assignment || assignment.student_id !== auth.user.id) return json({ error: 'Assignment not found' }, 404);
    const room = Array.isArray(assignment.room) ? assignment.room[0] : assignment.room;
    const roomRecord = record(room);
    const patientId = typeof roomRecord.patient_id === 'string' ? roomRecord.patient_id : null;
    const roomId = typeof roomRecord.id === 'number' ? roomRecord.id : null;
    if (!patientId || !roomId) return json({ error: 'This assignment has no linked patient chart' }, 409);
    const behavior = resolvePinnedConversationPrompt(roomRecord, assignment.scenario_baseline, 'consultant');
    if (!behavior) return json({ error: 'Consultant Conversation Prompt not configured. Ask an administrator to configure this room.' }, 409);

    const { data: existingRequest, error: existingError } = await admin.from('consultant_requests').select('id, response, disposition, consult_order_id, status').eq('assignment_id', payload.assignmentId).eq('client_request_id', request.clientRequestId).maybeSingle();
    if (existingError) throw existingError;
    if (existingRequest?.status === 'answered' || existingRequest?.status === 'assumes_care') return json({ message: existingRequest.response, disposition: existingRequest.disposition, orderId: existingRequest.consult_order_id, requestId: existingRequest.id, idempotent: true });

    const { data: consultRequest, error: requestError } = await admin.from('consultant_requests').upsert({ assignment_id: payload.assignmentId, patient_id: patientId, room_id: roomId, specialty, summary, clinical_question: clinicalQuestion, reason, urgency, client_request_id: request.clientRequestId, status: 'requested' }, { onConflict: 'assignment_id,client_request_id' }).select('id').single();
    if (requestError) throw requestError;
    createdRequestId = consultRequest.id;

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
    const completion = await openai.chat.completions.create({
      model: getOpenAIModel('chat'), max_completion_tokens: 500, response_format: { type: 'json_object' },
      messages: [
          { role: 'system', content: behavior },
        { role: 'system', content: 'Technical transport contract: return a JSON object with message (string) and disposition (routine_review or assumes_care). Do not add any other fields.' },
        { role: 'user', content: JSON.stringify({ specialty, summary, clinicalQuestion, reason, urgency }) },
      ],
    });
    const parsed = record(JSON.parse(completion.choices[0]?.message?.content ?? '{}'));
    const answer = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    if (!answer) throw new Error('Consultant response was empty');
    const disposition = parsed.disposition === 'assumes_care' ? 'assumes_care' : 'routine_review';
    const { data: order, error: orderError } = await admin.from('medical_orders').insert({ patient_id: patientId, assignment_id: payload.assignmentId, room_id: roomId, school_id: roomRecord.school_id ?? null, override_scope: 'assignment', category: 'Consult', order_name: `Consult: ${specialty}`, priority: urgency === 'emergent' ? 'STAT' : urgency === 'urgent' ? 'Urgent' : 'Routine', status: 'Active', ordered_by: 'Student', order_time: new Date().toISOString(), instructions: `Summary: ${summary}\nQuestion: ${clinicalQuestion}\nReason: ${reason}` }).select('id').single();
    if (orderError) throw orderError;
    createdOrderId = order.id;
    const { error: messageError } = await admin.from('consultant_chat_messages').insert([
      { assignment_id: payload.assignmentId, request_id: consultRequest.id, role: 'student', content: `${specialty} consult (${urgency}): ${summary} Question: ${clinicalQuestion} Reason: ${reason}`, specialty, urgency, consult_order_id: order.id },
      { assignment_id: payload.assignmentId, request_id: consultRequest.id, role: 'consultant', content: answer, specialty, urgency, consult_order_id: order.id },
    ]);
    if (messageError) throw messageError;
    // `routine_review` is a disposition, not a persistence status. The
    // status constraint uses `answered` for the routine path.
    const persistedStatus = disposition === 'assumes_care' ? 'assumes_care' : 'answered';
    const { error: updateError } = await admin.from('consultant_requests').update({ response: answer, disposition, consult_order_id: order.id, status: persistedStatus, answered_at: new Date().toISOString() }).eq('id', consultRequest.id);
    if (updateError) throw updateError;
    return json({ message: answer, disposition, orderId: order.id, requestId: consultRequest.id });
  } catch (error) {
    // Keep retries exact-once even if a downstream insert/update fails after
    // the idempotency row has been created. Service-role cleanup is scoped to
    // only artifacts created by this invocation.
    if (createdRequestId) {
      await admin.from('consultant_chat_messages').delete().eq('request_id', createdRequestId);
      if (createdOrderId) await admin.from('medical_orders').delete().eq('id', createdOrderId);
      await admin.from('consultant_requests').update({ status: 'failed' }).eq('id', createdRequestId);
    }
    return json({ error: error instanceof Error ? error.message : 'Consultant response failed' }, 500);
  }
});
