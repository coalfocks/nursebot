import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";
import { corsHeaders } from '../_shared/cors.ts';

type LabTest = {
  testName: string;
  unit?: string | null;
  referenceRange?: string | null;
};

type LabContext = {
  patient?: {
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    gender?: string;
    mrn?: string;
    allergies?: string[];
    codeStatus?: string;
    attendingPhysician?: string | null;
    service?: string | null;
  };
  room?: { id?: number | null; number?: string | null };
  assignmentId?: string | null;
  clinicalNotes?: Array<{ type?: string | null; title?: string | null; content?: string | null; timestamp?: string | null }>;
  vitals?: Array<Record<string, unknown>>;
  previousLabs?: Array<{
    testName?: string;
    value?: string | number | null;
    unit?: string | null;
    referenceRange?: string | null;
    status?: string | null;
    collectionTime?: string | null;
  }>;
  orders?: Array<{
    orderName?: string;
    category?: string;
    priority?: string;
    status?: string;
    instructions?: string | null;
  }>;
  emrContext?: Record<string, unknown> | string | null;
  nurseContext?: string | null;
  expectedDiagnosis?: string | null;
  expectedTreatment?: string[] | null;
  caseGoals?: string | null;
  difficultyLevel?: string | null;
  objective?: string | null;
  progressNote?: string | null;
  completionHint?: string | null;
  userRequest?: string | null;
};

type LabRequestPayload =
  | {
      labName: string;
      patientId?: string;
      priority?: 'Routine' | 'STAT' | 'Timed';
      valueOverride?: string | null;
      labType?: 'instant' | 'pending';
      ordersConfig?: Record<string, unknown> | null;
    }
  | {
      orderName: string;
      priority?: 'Routine' | 'STAT' | 'Timed';
      tests: LabTest[];
      instructions?: string | null;
      context?: LabContext;
    };

const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

const openai = openaiApiKey
  ? new OpenAI({
      apiKey: openaiApiKey,
    })
  : null;

const summarizeContext = (ctx?: LabContext) => {
  if (!ctx) return '';
  const lines: string[] = [];
  if (ctx.patient) {
    const p = ctx.patient;
    lines.push(
      `Patient: ${p.firstName ?? ''} ${p.lastName ?? ''} (${p.gender ?? ''}), DOB ${p.dateOfBirth ?? 'unknown'}, MRN ${
        p.mrn ?? 'n/a'
      }. Service: ${p.service ?? 'n/a'}. Attending: ${p.attendingPhysician ?? 'n/a'}. Code Status: ${p.codeStatus ?? 'n/a'}. Allergies: ${
        (p.allergies ?? []).join(', ') || 'None listed'
      }.`,
    );
  }
  if (ctx.room?.number || ctx.assignmentId) {
    lines.push(`Room: ${ctx.room?.number ?? 'n/a'}, Assignment: ${ctx.assignmentId ?? 'n/a'}.`);
  }
  if (ctx.difficultyLevel || ctx.objective) {
    lines.push(
      `Case difficulty: ${ctx.difficultyLevel ?? 'n/a'}. Objective: ${ctx.objective ?? 'n/a'}.`,
    );
  }
  if (ctx.expectedDiagnosis) {
    lines.push(`Expected/working diagnosis: ${ctx.expectedDiagnosis}.`);
  }
  if (ctx.expectedTreatment?.length) {
    lines.push(`Planned/expected treatments: ${ctx.expectedTreatment.join('; ')}`);
  }
  if (ctx.caseGoals) {
    lines.push(`Case goals: ${ctx.caseGoals}`);
  }
  if (ctx.progressNote) {
    lines.push(`Progress note summary: ${ctx.progressNote.slice(0, 280)}`);
  }
  if (ctx.emrContext) {
    lines.push(`EMR context: ${typeof ctx.emrContext === 'string' ? ctx.emrContext : JSON.stringify(ctx.emrContext)}`);
  }
  if (ctx.nurseContext) {
    lines.push(`Nurse context: ${ctx.nurseContext}`);
  }
  if (ctx.userRequest) {
    lines.push(`User-provided request: ${ctx.userRequest}`);
  }
  if (ctx.completionHint) {
    lines.push(`Completion hint: ${ctx.completionHint}`);
  }
  if (ctx.vitals?.length) {
    const latest = ctx.vitals[0];
    lines.push(`Recent vitals: ${JSON.stringify(latest)}`);
  }
  if (ctx.previousLabs?.length) {
    const summary = ctx.previousLabs
      .slice(0, 6)
      .map((lab) => `${lab.testName ?? 'Lab'}=${lab.value ?? '?'} (${lab.status ?? ''})`)
      .join('; ');
    lines.push(`Recent labs: ${summary}`);
  }
  if (ctx.clinicalNotes?.length) {
    const noteSummary = ctx.clinicalNotes
      .slice(0, 3)
      .map((note) => `${note.type ?? 'Note'}: ${note.title ?? ''}`)
      .join('; ');
    lines.push(`Notes: ${noteSummary}`);
  }
  if (ctx.orders?.length) {
    const orderSummary = ctx.orders
      .slice(0, 5)
      .map((order) => `${order.orderName ?? 'Order'} (${order.status ?? 'Active'})`)
      .join('; ');
    lines.push(`Other active orders: ${orderSummary}`);
  }
  return lines.join('\n');
};

const buildPrompt = (payload: LabRequestPayload): { system: string; user: string } => {
  const instructionText =
    'instructions' in payload && payload.instructions
      ? `User intent/context (must be honored): ${payload.instructions}`
      : '';
  if ('tests' in payload) {
    const priorityText = payload.priority ? `Priority: ${payload.priority}.` : '';
    const context = summarizeContext(payload.context);
    const requested = payload.tests.map((t) => t.testName).join(', ');

    const system = `You are a clinical lab engine for an EMR simulator. Given patient/room context and an order, you return realistic lab results. Always respond with JSON array only—no prose. Units and reference ranges must be clinically plausible. When the user provides intent/values, honor them explicitly (prefer user-requested values over context defaults unless they are physiologically impossible).`;

    const user = `
Generate results for these tests: ${requested}.
Order: ${payload.orderName}. ${priorityText}
${instructionText}
Context:
${context}
Return JSON array of objects:
[
  {
    "testName": "<name>",
    "value": <number|string>,
    "unit": "<unit or empty>",
    "referenceRange": "<range or empty>",
    "status": "Normal" | "Abnormal" | "Critical",
    "collectionTime": "<ISO8601>",
    "resultTime": "<ISO8601>"
  }
]
Match each requested test once. If user intent or requested values are present, use them directly unless they are unsafe/implausible—do not ignore userRequest. If uncertain, bias toward normal adult inpatient ranges; make abnormalities only when suggested by context or user intent.`;

    return { system, user };
  }

  const { labName, priority, valueOverride } = payload;
  const priorityText = priority ? `Priority: ${priority}.` : '';
  const overrideText = valueOverride ? `Use or anchor to this preset value when reasonable: ${valueOverride}.` : '';

  const system = 'You produce realistic, concise lab results for EMR training. Return JSON only.';
  const user = `
You are generating a single lab result for a simulated EMR. Respond with compact JSON only:
{ "value": <number|string>, "unit": "<unit or empty>", "referenceRange": "<range or empty>", "status": "Normal|Abnormal|Critical" }
${priorityText}
Lab: ${labName}.
${overrideText}
${instructionText}
Keep values realistic for adult inpatients. Do not add commentary outside the JSON.`;

  return { system, user };
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
    const isBatch = 'tests' in payload;
    if (!payload.labName && !isBatch) {
      return new Response(JSON.stringify({ error: 'labName or tests/orderName is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isBatch && payload.labType === 'pending') {
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

    const prompt = buildPrompt(payload);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.25,
      messages: [
        {
          role: 'system',
          content: prompt.system,
        },
        { role: 'user', content: prompt.user },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? '';
    const parsed = parseJsonFromString(content.trim() ?? '');

    if (!parsed) {
      throw new Error('Unable to parse AI response');
    }

    const responseBody = isBatch ? { labs: parsed } : parsed;

    return new Response(JSON.stringify(responseBody), {
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
