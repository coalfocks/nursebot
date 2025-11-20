import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';

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

      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages,
        temperature: 0.7,
        max_tokens: 10000,
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
