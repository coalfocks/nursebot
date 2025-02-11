import { serve } from 'https://deno.fresh.dev/std@v1/http/server.ts';
import { Configuration, OpenAIApi } from 'https://esm.sh/openai@4.24.1';
import { corsHeaders } from '../_shared/cors.ts';

interface ChatMessage {
  role: 'system' | 'assistant' | 'user';
  content: string;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();

    // Initialize OpenAI
    const openai = new OpenAIApi(new Configuration({
      apiKey: Deno.env.get('OPENAI_API_KEY'),
    }));

    // Get chat completion
    const completion = await openai.createChatCompletion({
      model: 'gpt-4',
      messages,
      temperature: 0.7,
      max_tokens: 500,
    });

    // Return the response
    return new Response(
      JSON.stringify({
        message: completion.data.choices[0].message?.content
      }),
      {
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
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
          'Content-Type': 'application/json' 
        },
      },
    );
  }
});