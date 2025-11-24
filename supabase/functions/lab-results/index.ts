import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";
import { corsHeaders } from '../_shared/cors.ts';

type LabRequestPayload = {
  labName: string;
  patientId?: string;
  priority?: 'Routine' | 'STAT' | 'Timed';
  valueOverride?: string | null;
  labType?: 'instant' | 'pending';
  ordersConfig?: Record<string, unknown> | null;
};

const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

const openai = openaiApiKey
  ? new OpenAI({
      apiKey: openaiApiKey,
    })
  : null;

const buildPrompt = (payload: LabRequestPayload) => {
  const { labName, priority, valueOverride } = payload;
  const priorityText = priority ? `Priority: ${priority}.` : '';
  const overrideText = valueOverride ? `Use or anchor to this preset value when reasonable: ${valueOverride}.` : '';

  return `
You are generating a single lab result for a simulated EMR. Respond with compact JSON only:
{ "value": <number|string>, "unit": "<unit or empty>", "referenceRange": "<range or empty>", "status": "Normal|Abnormal|Critical" }
${priorityText}
Lab: ${labName}.
${overrideText}
Keep values realistic for adult inpatients. Do not add commentary outside the JSON.`;
};

const parseJsonFromString = (content: string) => {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }
  return null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: LabRequestPayload = await req.json();
    if (!payload.labName) {
      return new Response(JSON.stringify({ error: 'labName is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (payload.labType === 'pending') {
      return new Response(
        JSON.stringify({
          value: null,
          unit: null,
          referenceRange: null,
          status: 'Pending',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!openai) {
      throw new Error('Missing OPENAI_API_KEY');
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: 'You produce realistic, concise lab results for EMR training. Return JSON only.',
        },
        { role: 'user', content: buildPrompt(payload) },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? '';
    const parsed = parseJsonFromString(content.trim() ?? '');

    if (!parsed) {
      throw new Error('Unable to parse AI response');
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('lab-results error', error);
    return new Response(JSON.stringify({ error: error?.message ?? 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
