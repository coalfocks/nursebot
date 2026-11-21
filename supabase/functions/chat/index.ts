import { buildNurseSystemPrompt, type NurseRoomContext } from './nurse-context.ts';
import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';

interface ChatMessage {
  role: 'system' | 'assistant' | 'user';
  content: string;
}

interface ChatRequestPayload {
  assignmentId?: string;
  assignment_id?: string;
  messages?: ChatMessage[];
  contentOverride?: string;
  triggeredCompletion?: boolean;
}

const assignmentWindowOpen = (assignment: { is_sandbox?: boolean | null; window_start?: string | null }) =>
  Boolean(assignment.is_sandbox) || !assignment.window_start || new Date(assignment.window_start).getTime() <= Date.now();

const resolvePinnedRoom = (room: NurseRoomContext | null, baseline: unknown) => {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) return room;
  return { ...room, ...(baseline as Partial<NurseRoomContext>) };
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: ChatRequestPayload = await req.json();
    const {
      assignmentId: camelCaseAssignmentId,
      assignment_id: snakeCaseAssignmentId,
      messages = [],
      contentOverride,
      triggeredCompletion
    } = payload;

    const resolvedAssignmentId = camelCaseAssignmentId ?? snakeCaseAssignmentId;

    if (!resolvedAssignmentId) {
      return new Response(
        JSON.stringify({ error: 'assignmentId is required' }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        }
      );
    }

    let assistantContent = contentOverride?.trim() ?? '';

    if (!assistantContent) {
      if (!Array.isArray(messages) || messages.length === 0) {
        return new Response(
          JSON.stringify({ error: 'messages array is required when contentOverride is not provided' }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          }
        );
      }

      const openai = new OpenAI({
        apiKey: Deno.env.get('OPENAI_API_KEY'),
      });

      const { data: assignment, error: assignmentError } = await supabaseAdmin
        .from('student_room_assignments')
        .select('scenario_baseline, is_sandbox, window_start, status, room:room_id(role, context, nurse_context, style, patient_id)')
        .eq('id', resolvedAssignmentId)
        .maybeSingle();
      if (assignmentError) throw assignmentError;
      if (!assignment || !assignmentWindowOpen(assignment)) {
        return new Response(JSON.stringify({ error: 'This assignment is not available yet.', code: 'ASSIGNMENT_NOT_ACTIVE' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const room = Array.isArray(assignment?.room) ? assignment.room[0] : assignment?.room;
      const pinnedRoom = resolvePinnedRoom(room as NurseRoomContext | null, assignment?.scenario_baseline);
      const patientId = pinnedRoom?.patient_id;
      let verifiedVitals = '';
      if (patientId) {
        const { data: vitals, error: vitalsError } = await supabaseAdmin
          .from('vital_signs')
          .select('id, timestamp, temperature, blood_pressure_systolic, blood_pressure_diastolic, heart_rate, respiratory_rate, oxygen_saturation')
          .eq('patient_id', patientId)
          .eq('assignment_id', resolvedAssignmentId)
          .is('deleted_at', null)
          .lte('timestamp', new Date().toISOString())
          .order('timestamp', { ascending: false })
          .limit(1);
        if (vitalsError) throw vitalsError;
        const latest = vitals?.[0];
        if (latest) verifiedVitals = `Source: vital_signs row ${latest.id}, patient ${patientId}, assignment ${resolvedAssignmentId}; recorded at ${latest.timestamp}. Temperature ${latest.temperature ?? 'not recorded'} °F; BP ${latest.blood_pressure_systolic ?? 'not recorded'}/${latest.blood_pressure_diastolic ?? 'not recorded'} mmHg, HR ${latest.heart_rate ?? 'not recorded'} beats/min, RR ${latest.respiratory_rate ?? 'not recorded'} breaths/min, SpO2 ${latest.oxygen_saturation ?? 'not recorded'}%. Oxygen support: use only what is supplied in authored context; no fresh reassessment is implied.`;
      }
      const learnerMessages = messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, content: message.content }));

      const completion = await openai.chat.completions.create({
        model: getOpenAIModel('chat'),
        messages: [
          { role: 'system', content: buildNurseSystemPrompt(pinnedRoom, verifiedVitals, assignment.scenario_baseline ? 'assignment scenario_baseline snapshot' : 'assigned room (no snapshot)') },
          ...learnerMessages,
        ],
        max_completion_tokens: 10000,
      });

      assistantContent = completion.choices[0].message?.content?.trim() ?? '';
    }

    if (!assistantContent) {
      throw new Error('Assistant response was empty');
    }

    const insertPayload: Record<string, unknown> = {
      assignment_id: resolvedAssignmentId,
      role: 'assistant',
      content: assistantContent,
    };

    if (typeof triggeredCompletion === 'boolean') {
      insertPayload.triggered_completion = triggeredCompletion;
    }

    const { data: insertedMessage, error: insertError } = await supabaseAdmin
      .from('chat_messages')
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    return new Response(
      JSON.stringify({
        message: assistantContent,
        chatMessage: insertedMessage,
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }
});
