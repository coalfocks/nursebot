import { OpenAI } from 'https://deno.land/x/openai@v4.68.1/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';

type ConsultantRequest = {
  specialty?: string;
  summary?: string;
  clinicalQuestion?: string;
  reason?: string;
  urgency?: 'routine' | 'urgent' | 'emergent';
  clientRequestId?: string;
};
type Payload = { assignmentId?: string; request?: ConsultantRequest };
const SPECIALTIES = new Set(['Medicine', 'Surgery', 'Pediatrics', 'OB/GYN', 'Cardiology', 'ICU', 'Neurology', 'Nephrology', 'Infectious Disease', 'Attending']);
const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) throw new Error('Missing Supabase service credentials');
const admin = createClient(url, serviceKey);
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const promptFrom = (room: Record<string, unknown>, baseline: unknown) => {
  const pinned = { ...room, ...(record(baseline)) };
  const direct = typeof pinned.consultant_response_prompt === 'string' ? pinned.consultant_response_prompt.trim() : '';
  const context = record(pinned.emr_context);
  const packageBedside = record(record(context.package).bedside);
  const packagePrompt = typeof packageBedside.consultantResponsePrompt === 'string' ? packageBedside.consultantResponsePrompt.trim() : '';
  return direct || packagePrompt;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
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
    const behavior = promptFrom(roomRecord, assignment.scenario_baseline);
    if (!behavior) return json({ error: 'No consultant behavior is configured for this case' }, 409);

    const { data: existingRequest, error: existingError } = await admin.from('consultant_requests').select('id, response, disposition, consult_order_id, status').eq('assignment_id', payload.assignmentId).eq('client_request_id', request.clientRequestId).maybeSingle();
    if (existingError) throw existingError;
    if (existingRequest?.status === 'answered' || existingRequest?.status === 'assumes_care') {
      return json({ message: existingRequest.response, disposition: existingRequest.disposition, orderId: existingRequest.consult_order_id, requestId: existingRequest.id, status: existingRequest.status, idempotent: true });
    }
    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
    const completion = await openai.chat.completions.create({
      model: getOpenAIModel('chat'), max_completion_tokens: 500, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `You are the ${specialty} consultant assigned to this simulated case. Follow this authored case-specific behavior prompt exactly:\n${behavior}\n\nDefault behavior: acknowledge the consult, give only one or two useful recommendations, and state that you will see the patient in the morning. Do not take over the case or reveal the diagnosis, hidden goals, or evaluation criteria. Never invent chart results. Explicit urgent exceptions in the authored case prompt override the default: ICU may accept transfer when ICU disposition is intended; Cardiology may direct the learner to the cath lab when indicated; Surgery may take the patient urgently to the OR when the case calls for it. If the consultant assumes care, mark disposition assumes_care; otherwise mark routine_review. Return JSON only: {"message":"concise response","disposition":"routine_review|assumes_care"}.` },
        { role: 'user', content: JSON.stringify({ specialty, summary, clinicalQuestion, reason, urgency }) },
      ],
    });
    const parsed = record(JSON.parse(completion.choices[0]?.message?.content ?? '{}'));
    const answer = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    if (!answer) throw new Error('Consultant response was empty');
    const disposition = parsed.disposition === 'assumes_care' ? 'assumes_care' : 'routine_review';
    const { data: persistedRows, error: persistenceError } = await admin.rpc('persist_consultant_response', {
      p_student_id: auth.user.id,
      p_assignment_id: payload.assignmentId,
      p_client_request_id: request.clientRequestId,
      p_patient_id: patientId,
      p_room_id: roomId,
      p_specialty: specialty,
      p_summary: summary,
      p_clinical_question: clinicalQuestion,
      p_reason: reason,
      p_urgency: urgency,
      p_response: answer,
      p_disposition: disposition,
    });
    if (persistenceError) throw persistenceError;
    const persisted = Array.isArray(persistedRows) ? persistedRows[0] : persistedRows;
    if (!persisted?.request_id || !persisted.response) throw new Error('Consultant persistence returned no saved response');
    return json({ message: persisted.response, disposition: persisted.disposition, orderId: persisted.order_id, requestId: persisted.request_id, status: persisted.status, idempotent: persisted.idempotent });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Consultant response failed' }, 500);
  }
});
