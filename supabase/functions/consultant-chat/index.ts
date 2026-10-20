import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';
import { resolvePinnedConversationPrompt } from '../_shared/conversation-prompt-config.ts';

type ConsultantRequest = {
  serviceId?: string;
  serviceLabel?: string;
  audience?: 'adult' | 'pediatric';
  message?: string;
  specialty?: string;
  summary?: string;
  clinicalQuestion?: string;
  reason?: string;
  urgency?: 'routine' | 'urgent' | 'emergent';
  clientRequestId?: string;
};
type Payload = { assignmentId?: string; request?: ConsultantRequest };
const SPECIALTIES = new Set([
  'Attending', 'Medicine', 'Surgery', 'Pediatrics', 'OB/GYN', 'Cardiology',
  'ICU', 'Neurology', 'Nephrology', 'Infectious Disease', 'Orthopedics', 'ENT',
  'Anesthesiology', 'Endocrinology', 'Hematology', 'Toxicology',
  'Pediatric Hepatology', 'Pediatric Cardiology', 'Pediatric Surgery',
  'Pediatric Emergency Medicine', 'Oncology', 'Pulmonology', 'Gastroenterology',
]);
const DIRECTORY: Record<string, { label: string; audience: 'adult' | 'pediatric'; aliases: string[] }> = {
  'adult-attending': { label: 'Attending / Hospital Medicine', audience: 'adult', aliases: ['attending', 'hospitalist', 'medicine'] },
  'adult-critical-care': { label: 'Adult Critical Care / ICU', audience: 'adult', aliases: ['icu'] },
  'adult-cardiology': { label: 'Cardiology', audience: 'adult', aliases: ['heart'] },
  'adult-interventional-cardiology': { label: 'Interventional Cardiology', audience: 'adult', aliases: ['cath'] },
  'adult-pulmonology': { label: 'Pulmonology', audience: 'adult', aliases: ['lung'] },
  'adult-gastroenterology': { label: 'Gastroenterology', audience: 'adult', aliases: ['gi'] },
  'adult-nephrology': { label: 'Nephrology', audience: 'adult', aliases: ['kidney'] },
  'adult-infectious-disease': { label: 'Infectious Disease', audience: 'adult', aliases: ['id'] },
  'adult-endocrinology': { label: 'Endocrinology', audience: 'adult', aliases: ['diabetes'] },
  'adult-neurology': { label: 'Neurology', audience: 'adult', aliases: ['neuro'] },
  'adult-hematology-oncology': { label: 'Hematology / Oncology', audience: 'adult', aliases: ['heme', 'oncology'] },
  'adult-rheumatology': { label: 'Rheumatology', audience: 'adult', aliases: ['rheum'] },
  'adult-general-surgery': { label: 'General Surgery', audience: 'adult', aliases: ['surgery'] },
  'adult-colorectal-surgery': { label: 'Colorectal Surgery', audience: 'adult', aliases: ['colorectal'] },
  'adult-neurosurgery': { label: 'Neurosurgery', audience: 'adult', aliases: [] },
  'adult-orthopedic-surgery': { label: 'Orthopedic Surgery', audience: 'adult', aliases: ['orthopedics'] },
  'adult-vascular-surgery': { label: 'Vascular Surgery', audience: 'adult', aliases: ['vascular'] },
  'adult-cardiothoracic-surgery': { label: 'Cardiothoracic Surgery', audience: 'adult', aliases: ['ct surgery'] },
  'adult-trauma-surgery': { label: 'Trauma Surgery', audience: 'adult', aliases: ['trauma'] },
  'adult-urology': { label: 'Urology', audience: 'adult', aliases: ['uro'] },
  'adult-otolaryngology': { label: 'Otolaryngology (ENT)', audience: 'adult', aliases: ['ent'] },
  'adult-ophthalmology': { label: 'Ophthalmology', audience: 'adult', aliases: ['eye'] },
  'adult-psychiatry': { label: 'Psychiatry', audience: 'adult', aliases: [] },
  'adult-anesthesia-pain': { label: 'Anesthesiology / Pain', audience: 'adult', aliases: ['anesthesia', 'pain'] },
  'adult-ob-gyn': { label: 'OB/GYN', audience: 'adult', aliases: ['obgyn'] },
  'adult-mfm': { label: 'Maternal-Fetal Medicine', audience: 'adult', aliases: ['mfm'] },
  'adult-palliative-care': { label: 'Palliative Care', audience: 'adult', aliases: ['palliative'] },
  'adult-radiology': { label: 'Radiology', audience: 'adult', aliases: ['imaging'] },
  'adult-interventional-radiology': { label: 'Interventional Radiology', audience: 'adult', aliases: ['ir'] },
  'adult-transfusion-medicine': { label: 'Transfusion Medicine', audience: 'adult', aliases: ['blood bank'] },
  'pediatric-hospital-medicine': { label: 'Pediatric Hospital Medicine', audience: 'pediatric', aliases: ['pediatrics', 'peds'] },
  'pediatric-critical-care': { label: 'Pediatric Critical Care / PICU', audience: 'pediatric', aliases: ['picu'] },
  'pediatric-neonatology': { label: 'Neonatology / NICU', audience: 'pediatric', aliases: ['nicu'] },
  'pediatric-cardiology': { label: 'Pediatric Cardiology', audience: 'pediatric', aliases: ['peds cardiology'] },
  'pediatric-pulmonology': { label: 'Pediatric Pulmonology', audience: 'pediatric', aliases: [] },
  'pediatric-gastroenterology': { label: 'Pediatric Gastroenterology / GI', audience: 'pediatric', aliases: ['peds gi'] },
  'pediatric-nephrology': { label: 'Pediatric Nephrology', audience: 'pediatric', aliases: [] },
  'pediatric-infectious-disease': { label: 'Pediatric Infectious Disease', audience: 'pediatric', aliases: ['peds id'] },
  'pediatric-endocrinology': { label: 'Pediatric Endocrinology', audience: 'pediatric', aliases: [] },
  'pediatric-neurology': { label: 'Pediatric Neurology', audience: 'pediatric', aliases: [] },
  'pediatric-hematology-oncology': { label: 'Pediatric Hematology / Oncology', audience: 'pediatric', aliases: ['pediatric oncology'] },
  'pediatric-rheumatology': { label: 'Pediatric Rheumatology', audience: 'pediatric', aliases: [] },
  'pediatric-general-surgery': { label: 'Pediatric General Surgery', audience: 'pediatric', aliases: ['peds surgery'] },
  'pediatric-colorectal-surgery': { label: 'Pediatric Colorectal Surgery', audience: 'pediatric', aliases: [] },
  'pediatric-neurosurgery': { label: 'Pediatric Neurosurgery', audience: 'pediatric', aliases: [] },
  'pediatric-orthopedic-surgery': { label: 'Pediatric Orthopedic Surgery', audience: 'pediatric', aliases: ['peds ortho'] },
  'pediatric-urology': { label: 'Pediatric Urology', audience: 'pediatric', aliases: [] },
  'pediatric-otolaryngology': { label: 'Pediatric ENT', audience: 'pediatric', aliases: ['peds ent'] },
  'pediatric-ophthalmology': { label: 'Pediatric Ophthalmology', audience: 'pediatric', aliases: [] },
  'pediatric-psychiatry': { label: 'Child and Adolescent Psychiatry', audience: 'pediatric', aliases: ['child psych'] },
  'pediatric-anesthesia-pain': { label: 'Pediatric Anesthesiology / Pain', audience: 'pediatric', aliases: ['peds anesthesia'] },
  'pediatric-palliative-care': { label: 'Pediatric Palliative Care', audience: 'pediatric', aliases: [] },
  'pediatric-radiology': { label: 'Pediatric Radiology', audience: 'pediatric', aliases: [] },
  'pediatric-interventional-radiology': { label: 'Pediatric Interventional Radiology', audience: 'pediatric', aliases: ['peds ir'] },
  'pediatric-transfusion-medicine': { label: 'Pediatric Transfusion Medicine', audience: 'pediatric', aliases: [] },
};
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
    const serviceId = request.serviceId?.trim() ?? '';
    const service = DIRECTORY[serviceId];
    const serviceLabel = request.serviceLabel?.trim() ?? '';
    const audience = request.audience;
    const message = request.message?.trim() ?? '';
    const specialty = service?.label ?? request.specialty?.trim() ?? '';
    const summary = message || request.summary?.trim() || '';
    const clinicalQuestion = message || request.clinicalQuestion?.trim() || '';
    const reason = request.reason?.trim() || 'Selected consultant conversation';
    const urgency = request.urgency ?? 'routine';
    if (!payload.assignmentId || !service || serviceLabel !== service.label || audience !== service.audience || !message && (!summary || !clinicalQuestion) || !request.clientRequestId || !['routine', 'urgent', 'emergent'].includes(urgency)) {
      return json({ error: 'A valid consultant service, matching audience, message, and request id are required' }, 400);
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

    const { data: existingRequest, error: existingError } = await admin.from('consultant_requests').select('id, response, disposition, consult_order_id, status, service_id, service_label, audience, message_text').eq('assignment_id', payload.assignmentId).eq('client_request_id', request.clientRequestId).maybeSingle();
    if (existingError) throw existingError;
    if (existingRequest && (existingRequest.service_id !== serviceId || existingRequest.audience !== audience || existingRequest.message_text !== message)) return json({ error: 'This request id is already bound to a different consultant message or audience' }, 409);
    if (existingRequest?.status === 'answered' || existingRequest?.status === 'assumes_care') return json({ message: existingRequest.response, disposition: existingRequest.disposition, orderId: existingRequest.consult_order_id, requestId: existingRequest.id, idempotent: true });

    const { data: consultRequest, error: requestError } = await admin.from('consultant_requests').upsert({ assignment_id: payload.assignmentId, patient_id: patientId, room_id: roomId, service_id: serviceId, service_label: service.label, audience, message_text: message || clinicalQuestion, specialty, summary, clinical_question: clinicalQuestion, reason, urgency, client_request_id: request.clientRequestId, status: 'requested' }, { onConflict: 'assignment_id,client_request_id' }).select('id').single();
    if (requestError) throw requestError;
    createdRequestId = consultRequest.id;

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
    const completion = await openai.chat.completions.create({
      model: getOpenAIModel('chat'), max_completion_tokens: 500, response_format: { type: 'json_object' },
      messages: [
          { role: 'system', content: behavior },
        { role: 'user', content: JSON.stringify({ routing: { serviceId, serviceLabel: service.label, audience }, message }) },
      ],
    });
    const parsed = record(JSON.parse(completion.choices[0]?.message?.content ?? '{}'));
    const answer = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    if (!answer) throw new Error('Consultant response was empty');
    const disposition = parsed.disposition === 'assumes_care' ? 'assumes_care' : 'routine_review';
    const { data: priorOrder } = await admin.from('consultant_requests').select('consult_order_id').eq('assignment_id', payload.assignmentId).eq('service_id', serviceId).eq('audience', audience).not('consult_order_id', 'is', null).neq('status', 'failed').order('created_at', { ascending: true }).limit(1).maybeSingle();
    let order = priorOrder?.consult_order_id ? { id: priorOrder.consult_order_id } : null;
    let orderError: { message: string } | null = null;
    if (!order) {
      const result = await admin.from('medical_orders').insert({ patient_id: patientId, assignment_id: payload.assignmentId, room_id: roomId, school_id: roomRecord.school_id ?? null, override_scope: 'assignment', category: 'Consult', order_name: `Consult: ${service.label}`, priority: urgency === 'emergent' ? 'STAT' : urgency === 'urgent' ? 'Urgent' : 'Routine', status: 'Active', ordered_by: 'Student', order_time: new Date().toISOString(), instructions: `Service: ${service.label} (${audience})\nMessage: ${message || clinicalQuestion}` }).select('id').single();
      order = result.data;
      orderError = result.error;
    }
    if (orderError) throw orderError;
    if (!order) throw new Error('Consult order could not be resolved');
    createdOrderId = order.id;
    const { error: messageError } = await admin.from('consultant_chat_messages').insert([
      { assignment_id: payload.assignmentId, request_id: consultRequest.id, role: 'student', content: message || clinicalQuestion, service_id: serviceId, service_label: service.label, audience, specialty, urgency, consult_order_id: order.id },
      { assignment_id: payload.assignmentId, request_id: consultRequest.id, role: 'consultant', content: answer, service_id: serviceId, service_label: service.label, audience, specialty, urgency, consult_order_id: order.id },
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
