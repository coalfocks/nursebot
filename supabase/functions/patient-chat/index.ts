import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";
import { corsHeaders } from '../_shared/cors.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';

interface ChatMessage {
  role: 'system' | 'assistant' | 'user';
  content: string;
}

interface PatientChatPayload {
  messages?: ChatMessage[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: PatientChatPayload = await req.json();
    const messages = payload.messages ?? [];
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const openai = new OpenAI({
      apiKey: Deno.env.get('OPENAI_API_KEY'),
    });

    const completion = await openai.chat.completions.create({
      model: getOpenAIModel('patient_chat'),
      messages,
      max_completion_tokens: 800,
    });

    const message = completion.choices[0].message?.content?.trim() ?? '';
    if (!message) throw new Error('Patient response was empty');

    return new Response(JSON.stringify({ message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
