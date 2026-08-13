import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const shouldGenerate = args.has('--generate');
const dryRun = args.has('--dry-run');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : null;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const asText = (value, fallback = '') => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length) return value.filter(Boolean).join('\n');
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return fallback;
};

const parseMaybeJson = (value) => {
  if (!value || typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const mapDifficulty = (difficulty) => {
  switch (difficulty) {
    case 'beginner':
      return 'easy';
    case 'advanced':
      return 'difficult';
    case 'intermediate':
    default:
      return 'intermediate';
  }
};

const buildBlueprintFromRoom = (room) => {
  const emrContext = parseMaybeJson(room.emr_context);
  const generatedPackage = emrContext?.package && typeof emrContext.package === 'object'
    ? emrContext.package
    : null;
  const emr = generatedPackage?.emr ?? {};
  const event = generatedPackage?.event ?? {};
  const orders = generatedPackage?.orders ?? {};
  const bedside = generatedPackage?.bedside ?? {};

  return {
    title: asText(room.role, `Room ${room.room_number}`),
    specialty: asText(room.specialty?.name, 'Internal Medicine'),
    difficulty: mapDifficulty(room.difficulty_level),
    objectives: asText(room.objective, room.case_goals || 'Legacy room migrated for Nurse Althea v2 generation.'),
    admitting_hpi: asText(
      emr.hAndP,
      asText(room.emr_context, asText(room.context, 'Legacy room context was empty; review before publishing.')),
    ),
    hospital_days: null,
    admit_orders: asText(orders.admissionOrders, null),
    admission_vitals: asText(emr.admissionVitals, null),
    admission_labs: asText(emr.admissionLabs, null),
    admission_exam: asText(emr.admissionExam, null),
    initial_message: asText(event.trigger, asText(room.context, null)),
    bedside_requirement: room.bedside_requirement ?? 'situational',
    bedside_required: room.bedside_requirement === 'yes',
    patient_chat_enabled: Boolean(emrContext?.patientChat?.enabled ?? bedside.patientChatEnabled),
    consults: asText(emr.consultNotes, null),
    event_vitals: asText(event.eventVitals, null),
    nurse_exam: asText(event.nurseObservations, null),
    bedside_exam: asText(bedside.exam, room.bedside_hint ?? null),
    typical_questions: [],
    imaging_and_orders: asText(orders.imaging, null),
    harmful_actions: Array.isArray(orders.harmfulOrUnnecessary) ? orders.harmfulOrUnnecessary : [],
    progress_note: asText(room.progress_note, asText(room.example_progress_note, null)),
    room_number: room.room_number,
    school_id: room.school_id,
    created_by: room.created_by,
    generation_package: generatedPackage,
    generation_status: generatedPackage ? 'generated' : 'not_generated',
    generated_at: generatedPackage ? new Date().toISOString() : null,
  };
};

const callGenerateCasePackage = async (blueprint) => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/generate-case-package`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      blueprint,
      section: null,
      existingPackage: blueprint.generation_package ?? null,
    }),
  });

  if (!response.ok) {
    throw new Error(`generate-case-package failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
};

const main = async () => {
  let query = supabase
    .from('rooms')
    .select(`
      id,
      room_number,
      role,
      context,
      nurse_context,
      emr_context,
      case_goals,
      objective,
      progress_note,
      example_progress_note,
      difficulty_level,
      bedside_hint,
      bedside_requirement,
      school_id,
      created_by,
      specialty:specialty_id(name)
    `)
    .order('room_number');

  if (limit) query = query.limit(limit);

  const { data: rooms, error: roomsError } = await query;
  if (roomsError) throw roomsError;

  let migrated = 0;
  let skipped = 0;
  let generated = 0;

  for (const room of rooms ?? []) {
    const { data: existing, error: existingError } = await supabase
      .from('case_blueprints')
      .select('id, generation_status')
      .eq('room_number', room.room_number)
      .eq('school_id', room.school_id)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing) {
      skipped += 1;
      continue;
    }

    const blueprint = buildBlueprintFromRoom(room);
    console.log(`${dryRun ? 'Would migrate' : 'Migrating'} room ${room.room_number}: ${blueprint.title}`);

    if (dryRun) {
      migrated += 1;
      continue;
    }

    const { data: inserted, error: insertError } = await supabase
      .from('case_blueprints')
      .insert(blueprint)
      .select()
      .single();
    if (insertError) throw insertError;
    migrated += 1;

    if (shouldGenerate) {
      const result = await callGenerateCasePackage(inserted);
      const { error: updateError } = await supabase
        .from('case_blueprints')
        .update({
          generation_package: result.package,
          generation_status: 'generated',
          generation_error: null,
          generated_at: result.generatedAt ?? new Date().toISOString(),
        })
        .eq('id', inserted.id);
      if (updateError) throw updateError;
      generated += 1;
    }
  }

  console.log(`Done. Migrated: ${migrated}. Skipped existing: ${skipped}. Generated: ${generated}.`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
