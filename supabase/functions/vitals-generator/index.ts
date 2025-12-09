import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";
import { corsHeaders } from '../_shared/cors.ts';

type VitalContext = {
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
  previousVitals?: Array<Record<string, unknown>>;
  previousLabs?: Array<{
    testName?: string;
    value?: string | number | null;
    unit?: string | null;
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
};

type VitalsRequestPayload = {
  context?: VitalContext;
  count?: number;
};

const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

const openai = openaiApiKey
  ? new OpenAI({
      apiKey: openaiApiKey,
    })
  : null;

const summarizeContext = (ctx?: VitalContext) => {
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
    lines.push(`Case difficulty: ${ctx.difficultyLevel ?? 'n/a'}. Objective: ${ctx.objective ?? 'n/a'}.`);
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
  if (ctx.completionHint) {
    lines.push(`Completion hint: ${ctx.completionHint}`);
  }
  if (ctx.previousVitals?.length) {
    lines.push(`Recent vitals: ${JSON.stringify(ctx.previousVitals[0])}`);
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

const buildPrompt = (payload: VitalsRequestPayload) => {
  const context = summarizeContext(payload.context);
  const count = payload.count ?? 6;
  const system = `You are a clinical vitals engine for an EMR simulator. You return realistic serial vital signs with timestamps. Always respond with JSON array only—no prose.`;
  const user = `Generate ${count} recent vital sign entries for this inpatient. Context:\n${context}\nReturn JSON array of objects with keys: id (string), timestamp (ISO8601), temperature (F), bloodPressureSystolic, bloodPressureDiastolic, heartRate, respiratoryRate, oxygenSaturation, pain. Make trends plausible with the context; default to stable/normal if not specified.`;
  return { system, user };
};

const parseJsonFromString = (content: string) => {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\[[\s\S]*\]/);
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
    const payload: VitalsRequestPayload = await req.json();

    if (!openai) {
      throw new Error('Missing OPENAI_API_KEY');
    }

    const prompt = buildPrompt(payload);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0.25,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? '';
    const parsed = parseJsonFromString(content.trim() ?? '');

    if (!parsed || !Array.isArray(parsed)) {
      throw new Error('Unable to parse AI response');
    }

    return new Response(JSON.stringify({ vitals: parsed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('vitals-generator error', error);
    return new Response(JSON.stringify({ error: error?.message ?? 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
