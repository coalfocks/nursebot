import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';
import { decideExistingPatientChatRequest } from '../_shared/patient-chat-request-claim.ts';
import { resolvePatientChatConfig, type PatientChatRoomConfig } from '../_shared/patient-chat-config.ts';

interface ChatMessage {
  role: 'system' | 'assistant' | 'user';
  content: string;
}

interface PatientChatPayload {
  assignmentId?: string;
  clientMessageId?: string;
  messages?: ChatMessage[];
}

type PatientChatRoom = PatientChatRoomConfig;

const resolvePinnedRoom = (room: PatientChatRoom | null, baseline: unknown) => {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return room;
  return { ...room, ...(baseline as Partial<PatientChatRoom>) };
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service credentials');
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const requestLeaseMs = 60_000;

type PatientChatRequest = {
  id: string;
  status: 'pending' | 'completed' | 'failed';
  response_content: string | null;
  response_role: 'patient' | 'caregiver' | null;
  lease_expires_at: string | null;
};

type PatientChatReply = {
  content: string;
  role: 'patient' | 'caregiver';
};

const findPersistedReply = async (assignmentId: string, clientMessageId: string) => {
  const { data: reply, error } = await supabaseAdmin
    .from('patient_chat_messages')
    .select('content, role')
    .eq('assignment_id', assignmentId)
    .eq('reply_to_client_message_id', clientMessageId)
    .maybeSingle<PatientChatReply>();
  if (error) throw error;
  return reply;
};

const completeRequest = async (requestId: string, reply: PatientChatReply) => {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('patient_chat_requests')
    .update({
      status: 'completed',
      response_content: reply.content,
      response_role: reply.role,
      lease_expires_at: null,
      completed_at: now,
      updated_at: now,
    })
    .eq('id', requestId)
    .eq('status', 'pending');
  if (error) throw error;
};

const claimRequest = async (assignmentId: string, clientMessageId: string) => {
  const leaseExpiresAt = new Date(Date.now() + requestLeaseMs).toISOString();
  const requestFields = 'id, status, response_content, response_role, lease_expires_at';
  const { data: insertedRequest, error: insertError } = await supabaseAdmin
    .from('patient_chat_requests')
    .insert({
      assignment_id: assignmentId,
      client_message_id: clientMessageId,
      status: 'pending',
      lease_expires_at: leaseExpiresAt,
    })
    .select(requestFields)
    .maybeSingle<PatientChatRequest>();

  if (insertedRequest) return { kind: 'claimed' as const, request: insertedRequest };
  if (insertError && insertError.code !== '23505') throw insertError;

  const { data: existingRequest, error: existingError } = await supabaseAdmin
    .from('patient_chat_requests')
    .select(requestFields)
    .eq('assignment_id', assignmentId)
    .eq('client_message_id', clientMessageId)
    .maybeSingle<PatientChatRequest>();
  if (existingError) throw existingError;
  if (!existingRequest) throw new Error('Request claim was not persisted');

  const now = new Date().toISOString();
  const decision = decideExistingPatientChatRequest(existingRequest, now);
  if (decision === 'completed') {
    return { kind: 'completed' as const, request: existingRequest };
  }
  if (decision === 'processing') {
    return { kind: 'processing' as const, request: existingRequest };
  }

  const { data: reclaimedRequest, error: reclaimError } = await supabaseAdmin
    .from('patient_chat_requests')
    .update({
      status: 'pending',
      response_content: null,
      response_role: null,
      error_code: null,
      lease_expires_at: leaseExpiresAt,
      completed_at: null,
      updated_at: now,
    })
    .eq('id', existingRequest.id)
    .or(`status.eq.failed,and(status.eq.pending,lease_expires_at.lte.${now})`)
    .select(requestFields)
    .maybeSingle<PatientChatRequest>();
  if (reclaimError) throw reclaimError;
  if (reclaimedRequest) return { kind: 'claimed' as const, request: reclaimedRequest };

  const { data: activeRequest, error: activeError } = await supabaseAdmin
    .from('patient_chat_requests')
    .select(requestFields)
    .eq('id', existingRequest.id)
    .maybeSingle<PatientChatRequest>();
  if (activeError) throw activeError;
  if (activeRequest?.status === 'completed') {
    return { kind: 'completed' as const, request: activeRequest };
  }
  return { kind: 'processing' as const, request: activeRequest ?? existingRequest };
};

const markRequestFailed = async (requestId: string) => {
  await supabaseAdmin
    .from('patient_chat_requests')
    .update({
      status: 'failed',
      error_code: 'request_failed',
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)
    .eq('status', 'pending');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const accessToken = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const authClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) throw new Error('Unauthorized');

    const payload: PatientChatPayload = await req.json();
    if (!payload.assignmentId) {
      return new Response(JSON.stringify({ error: 'assignmentId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!payload.clientMessageId) {
      return new Response(JSON.stringify({ error: 'clientMessageId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const messages = payload.messages ?? [];
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from('student_room_assignments')
      .select(
        // Keep this projection compatible with production schemas that do not
        // yet have the optional dedicated mode column. Structured mode is
        // resolved from the pinned nested/legacy configuration instead.
        'scenario_baseline, room:room_id(emr_context, patient_conversation_prompt, patient_conversation_enabled, patient_participation_reason, patient_speaker_type)',
      )
      .eq('id', payload.assignmentId)
      .eq('student_id', authData.user.id)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    const room = Array.isArray(assignment?.room) ? assignment.room[0] : assignment?.room;
    const pinnedRoom = resolvePinnedRoom(room as PatientChatRoom | null, assignment?.scenario_baseline);
    const config = resolvePatientChatConfig(pinnedRoom);
    if (!config.enabled) {
      return new Response(JSON.stringify({ error: config.reason }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const requestClaim = await claimRequest(payload.assignmentId, payload.clientMessageId);
    const requestId = requestClaim.request.id;
    if (requestClaim.kind === 'processing') {
      return jsonResponse({ error: 'Request is already processing', requestId, retryable: true }, 409);
    }
    if (requestClaim.kind === 'completed') {
      return jsonResponse({
        message: requestClaim.request.response_content,
        requestId,
        replayed: true,
      });
    }

    try {
      const persistedReply = await findPersistedReply(payload.assignmentId, payload.clientMessageId);
      if (persistedReply) {
        await completeRequest(requestId, persistedReply);
        return jsonResponse({ message: persistedReply.content, requestId, replayed: true });
      }

      if (config.responseMode === 'unable') {
        const reply = { content: 'Patient unable to respond.', role: config.speaker as 'patient' | 'caregiver' };
        const { error: replySaveError } = await supabaseAdmin.from('patient_chat_messages').insert({
          assignment_id: payload.assignmentId,
          role: reply.role,
          content: reply.content,
          reply_to_client_message_id: payload.clientMessageId,
        });
        if (replySaveError) {
          if (replySaveError.code !== '23505') throw replySaveError;
          const existingReply = await findPersistedReply(payload.assignmentId, payload.clientMessageId);
          if (!existingReply) throw replySaveError;
          await completeRequest(requestId, existingReply);
          return jsonResponse({ message: existingReply.content, requestId, replayed: true });
        }
        await completeRequest(requestId, reply);
        return jsonResponse({ message: reply.content, requestId });
      }

      const openai = new OpenAI({
        apiKey: Deno.env.get('OPENAI_API_KEY'),
      });

      const completion = await openai.chat.completions.create({
        model: getOpenAIModel('patient_chat'),
        messages: [
          {
            role: 'system',
            // The authored prompt is the complete clinical/persona
            // instruction. Do not append nurse context, goals, diagnosis, or
            // a canned personality/response policy here.
            content: config.prompt,
          },
          ...messages
            .filter((message) => message.role !== 'system')
            .map((message) => ({ role: message.role, content: message.content })),
        ],
        max_completion_tokens: 800,
      });

      const message = completion.choices[0].message?.content?.trim() ?? '';
      if (!message) throw new Error('Patient response was empty');

      const { error: replySaveError } = await supabaseAdmin.from('patient_chat_messages').insert({
        assignment_id: payload.assignmentId,
        role: config.speaker,
        content: message,
        reply_to_client_message_id: payload.clientMessageId,
      });
      if (replySaveError) {
        if (replySaveError.code !== '23505') throw replySaveError;
        const existingReply = await findPersistedReply(payload.assignmentId, payload.clientMessageId);
        if (!existingReply) throw replySaveError;
        await completeRequest(requestId, existingReply);
        return jsonResponse({ message: existingReply.content, requestId, replayed: true });
      }

      await completeRequest(requestId, { content: message, role: config.speaker });

      return jsonResponse({ message, requestId });
    } catch {
      await markRequestFailed(requestId);
      return jsonResponse({ error: 'Patient response unavailable. Please try again.', requestId, retryable: true }, 500);
    }
  } catch {
    return jsonResponse({ error: 'Request failed' }, 500);
  }
});
