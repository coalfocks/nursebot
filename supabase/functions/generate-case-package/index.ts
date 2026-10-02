import { OpenAI } from "https://deno.land/x/openai@v4.68.1/mod.ts";
import { corsHeaders } from '../_shared/cors.ts';
import { getOpenAIModel } from '../_shared/openai-model.ts';

type GenerationSection =
  | 'patient'
  | 'emr'
  | 'event'
  | 'orders'
  | 'bedside'
  | 'nurse_chat'
  | 'evaluation';

type CaseBlueprintPayload = {
  title: string;
  specialty: string;
  room_number?: string | null;
  difficulty: string;
  objectives: string;
  admitting_hpi: string;
  hospital_days?: number | null;
  admit_orders?: string | null;
  admission_vitals?: string | null;
  admission_labs?: string | null;
  admission_exam?: string | null;
  initial_message?: string | null;
  bedside_requirement?: string | null;
  bedside_required?: boolean | null;
  patient_chat_enabled?: boolean | null;
  consults?: string | null;
  event_vitals?: string | null;
  nurse_exam?: string | null;
  bedside_exam?: string | null;
  typical_questions?: string[] | null;
  imaging_and_orders?: string | null;
  harmful_actions?: string[] | null;
  progress_note?: string | null;
};

type GenerateCasePackagePayload = {
  blueprint?: CaseBlueprintPayload;
  section?: GenerationSection | null;
  existingPackage?: Record<string, unknown> | null;
};

const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
const openai = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

const sectionKeys: GenerationSection[] = [
  'patient',
  'emr',
  'event',
  'orders',
  'bedside',
  'nurse_chat',
  'evaluation',
];

const packageSkeleton = {
  patient: {
    demographics: '',
    allergies: '',
    codeStatus: '',
    medicationList: [] as string[],
    intakeOutput: [] as string[],
  },
  emr: {
    admissionVitals: '',
    admissionLabs: [] as string[],
    admissionExam: '',
    hAndP: '',
    dailyProgressNotes: [] as string[],
    consultNotes: [] as string[],
    nursingNotes: [] as string[],
    labTrends: [] as string[],
  },
  event: {
    trigger: '',
    eventVitals: '',
    nurseObservations: '',
    timeCourse: [] as string[],
  },
  orders: {
    admissionOrders: [] as string[],
    expectedOrders: [] as string[],
    gatedResults: [] as string[],
    imaging: [] as string[],
    harmfulOrUnnecessary: [] as string[],
  },
  bedside: {
    requirement: 'no',
    exam: '',
    patientChatEnabled: false,
    patientChatPrompt: '',
    disableReason: '',
  },
  nurse_chat: {
    initialMessage: '',
    behaviorRules: [] as string[],
    knownFacts: [] as string[],
    protectedFacts: [] as string[],
  },
  evaluation: {
    goals: [] as string[],
    expectedWorkup: [] as string[],
    criticalActions: [] as string[],
    unsafeActions: [] as string[],
    bedsideVerdict: '',
    modelProgressNote: '',
    feedbackRubric: [] as string[],
  },
};

const stringifyBlueprint = (blueprint: CaseBlueprintPayload) => JSON.stringify(blueprint, null, 2);

const schemaInstruction = `Return compact JSON only. Use this exact top-level shape:
{
  "patient": {
    "demographics": "age/sex and brief background, no real PHI",
    "allergies": "string",
    "codeStatus": "string",
    "medicationList": ["medication, dose, route, standard frequency"],
    "intakeOutput": ["time-labeled I/O trend"]
  },
  "emr": {
    "admissionVitals": "string",
    "admissionLabs": ["12h/36h/60h prior style values when helpful"],
    "admissionExam": "string",
    "hAndP": "string",
    "dailyProgressNotes": ["one per relevant hospital day"],
    "consultNotes": ["consult specialty and recommendation"],
    "nursingNotes": ["brief shift-style note"],
    "labTrends": ["trendable lab value series"]
  },
  "event": {
    "trigger": "what prompts the nurse message",
    "eventVitals": "string",
    "nurseObservations": "short nurse-observable facts only",
    "timeCourse": ["ordered clinical timeline"]
  },
  "orders": {
    "admissionOrders": ["order with standard frequency only"],
    "expectedOrders": ["orders the learner should place"],
    "gatedResults": ["result visible only after matching order"],
    "imaging": ["imaging order + required result"],
    "harmfulOrUnnecessary": ["unsafe or low-value actions"]
  },
  "bedside": {
    "requirement": "yes|no|situational",
    "exam": "what the learner sees in person",
    "patientChatEnabled": true,
    "patientChatPrompt": "patient persona and answer boundaries, empty if disabled",
    "disableReason": "why chat is disabled if altered/sedated/intubated/unconscious"
  },
  "nurse_chat": {
    "initialMessage": "short text-style nurse opening",
    "behaviorRules": ["short replies", "answer only asked question", "no hints", "no diagnosis leakage", "order-gated results"],
    "knownFacts": ["facts the nurse can say"],
    "protectedFacts": ["facts to keep in EMR/results until ordered or directly observed"]
  },
  "evaluation": {
    "goals": ["case goals"],
    "expectedWorkup": ["expected decisions/orders"],
    "criticalActions": ["must-do actions"],
    "unsafeActions": ["harmful actions"],
    "bedsideVerdict": "yes|no|situational plus rationale",
    "modelProgressNote": "three-sentence ideal note",
    "feedbackRubric": ["free feedback point"]
  }
}`;

const buildPrompt = ({ blueprint, section, existingPackage }: Required<GenerateCasePackagePayload>) => {
  const difficultyRule =
    'Difficulty is metadata only. Do not make the case easier/harder, leak more/less, or change hint strength based on difficulty.';
  const safetyRules = [
    difficultyRule,
    'Use standard medication/order frequencies only. Do not invent custom frequency ranges.',
    'Keep nurse chat short and text-like. No suggestions, no hints, no diagnosis leakage.',
    'Gate lab, imaging, and study results behind matching placed orders.',
    'Use the blueprint overrides exactly when present; otherwise generate clinically plausible content.',
    'Generate enough chart depth to match hospital_days. If hospital_days is absent, infer a plausible inpatient course.',
    'Disable bedside patient chat for altered, sedated, intubated, unconscious, or otherwise non-participatory patients.',
    'Future reverse-mode should remain possible: keep learner-facing nurse behavior separate from hidden evaluation facts.',
  ].join('\n- ');

  if (section) {
    return {
      system:
        'You are Nurse Althea v2 case package generator. Regenerate exactly one section of an existing generated package.',
      user: `Regenerate only the "${section}" section from this case blueprint. Return JSON for that section only, not the full package.

Rules:
- ${safetyRules}

Blueprint:
${stringifyBlueprint(blueprint)}

Existing package:
${JSON.stringify(existingPackage, null, 2)}

The section must still fit the rest of the existing package.`,
    };
  }

  return {
    system:
      'You are Nurse Althea v2 case package generator for a medical education simulator.',
    user: `Generate a complete preview package from this blueprint.

Rules:
- ${safetyRules}

${schemaInstruction}

Blueprint:
${stringifyBlueprint(blueprint)}`,
  };
};

const parseJsonFromString = (content: string) => {
  try {
    return JSON.parse(content);
  } catch {
    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
  }
  return null;
};

const normalizePackage = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return packageSkeleton;
  }
  return {
    ...packageSkeleton,
    ...(value as Record<string, unknown>),
  };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: GenerateCasePackagePayload = await req.json();
    if (!openai) throw new Error('Missing OPENAI_API_KEY');
    if (!payload.blueprint?.title || !payload.blueprint.objectives || !payload.blueprint.admitting_hpi) {
      throw new Error('Missing required case blueprint fields');
    }
    if (payload.section && !sectionKeys.includes(payload.section)) {
      throw new Error(`Unsupported generation section: ${payload.section}`);
    }

    const existingPackage = normalizePackage(payload.existingPackage);
    const prompt = buildPrompt({
      blueprint: payload.blueprint,
      section: payload.section ?? null,
      existingPackage,
    });

    const completion = await openai.chat.completions.create({
      model: getOpenAIModel('generate_case_package'),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    });

    const parsed = parseJsonFromString(completion.choices[0]?.message?.content?.trim() ?? '');
    if (!parsed) throw new Error('Unable to parse generated case package');

    const generatedPackage = payload.section
      ? {
          ...existingPackage,
          [payload.section]: parsed,
        }
      : normalizePackage(parsed);

    return new Response(
      JSON.stringify({
        package: generatedPackage,
        generatedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('generate-case-package error', error);
    return new Response(JSON.stringify({ error: error?.message ?? 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
