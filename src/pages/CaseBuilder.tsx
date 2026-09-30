import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, Plus, Wand2, ClipboardCopy, CheckCircle, RefreshCw, FileText, UploadCloud } from 'lucide-react';
import { supabase } from '../lib/supabase';
import AdminLayout from '../components/admin/AdminLayout';
import SchoolScopeSelector from '../components/admin/SchoolScopeSelector';
import { useAuthStore } from '../stores/authStore';
import type { Database, Json } from '../lib/database.types';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';

type CaseBlueprint = Database['public']['Tables']['case_blueprints']['Row'];
type BedsideRequirement = 'yes' | 'no' | 'situational';
type GenerationSection =
  | 'patient'
  | 'emr'
  | 'event'
  | 'orders'
  | 'bedside'
  | 'nurse_chat'
  | 'evaluation';

type GeneratedCasePackage = {
  patient?: Record<string, unknown>;
  emr?: Record<string, unknown>;
  event?: Record<string, unknown>;
  orders?: Record<string, unknown>;
  bedside?: Record<string, unknown>;
  nurse_chat?: Record<string, unknown>;
  evaluation?: Record<string, unknown>;
};

type CaseFormState = {
  specialty: string;
  title: string;
  roomNumber: string;
  difficulty: CaseBlueprint['difficulty'];
  objectives: string;
  admittingHpi: string;
  hospitalDays: string;
  admitOrders: string;
  admissionVitals: string;
  admissionLabs: string;
  admissionExam: string;
  initialMessage: string;
  bedsideRequirement: BedsideRequirement;
  patientChatEnabled: boolean;
  consults: string;
  eventVitals: string;
  nurseExam: string;
  bedsideExam: string;
  typicalQuestions: string[];
  imagingAndOrders: string;
  harmfulActions: string[];
  progressNote: string;
};

const specialtyOptions = [
  'Internal Medicine',
  'Cardiology',
  'Neurology',
  'OBGYN',
  'Surgery',
  'Orthopedic Surgery',
  'Neurosurgery',
  'ENT',
  'Ophthalmology',
  'Pediatrics',
  'Psychiatry',
  'EM',
  'Family Medicine',
];

const difficultyLabels: Record<CaseBlueprint['difficulty'], string> = {
  easy: 'Easy / Short',
  intermediate: 'Intermediate',
  difficult: 'Difficult',
};

const bedsideRequirementLabels: Record<BedsideRequirement, string> = {
  yes: 'Yes',
  no: 'No',
  situational: 'Situational',
};

const generationSections: Array<{ key: GenerationSection; label: string }> = [
  { key: 'patient', label: 'Patient' },
  { key: 'emr', label: 'EMR' },
  { key: 'event', label: 'Event' },
  { key: 'orders', label: 'Orders' },
  { key: 'bedside', label: 'Bedside' },
  { key: 'nurse_chat', label: 'Nurse chat' },
  { key: 'evaluation', label: 'Evaluation' },
];

const getBlueprintBedsideRequirement = (blueprint: CaseBlueprint): BedsideRequirement => {
  const raw = blueprint.bedside_requirement;
  if (raw === 'yes' || raw === 'no' || raw === 'situational') return raw;
  return blueprint.bedside_required ? 'yes' : 'no';
};

const asGeneratedPackage = (value: Json | null): GeneratedCasePackage | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as GeneratedCasePackage;
};

const fieldLabel = (key: string) =>
  key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatGeneratedValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n');
  }
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return value == null || value === '' ? '—' : String(value);
};

const asStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : JSON.stringify(item)))
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
};

const asString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length) return asStringArray(value).join('\n');
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return null;
};

const buildRoomText = (...values: unknown[]) =>
  values
    .map(asString)
    .filter(Boolean)
    .join('\n\n');

const getGeneratedSection = (
  generatedPackage: GeneratedCasePackage | null,
  section: keyof GeneratedCasePackage,
) => {
  const value = generatedPackage?.[section];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};

const createClinicalNotePayloads = (
  patientId: string,
  schoolId: string,
  roomId: number,
  generatedPackage: GeneratedCasePackage,
) => {
  const emr = getGeneratedSection(generatedPackage, 'emr');
  const now = new Date().toISOString();
  const notePayloads: Array<Record<string, unknown>> = [];

  const addNote = (noteType: string, title: string, content: unknown, offsetMinutes = 0) => {
    const noteContent = asString(content);
    if (!noteContent) return;
    notePayloads.push({
      patient_id: patientId,
      school_id: schoolId,
      room_id: roomId,
      override_scope: 'room',
      note_type: noteType,
      title,
      content: noteContent,
      author: 'Nurse Althea Generator',
      timestamp: new Date(new Date(now).getTime() + offsetMinutes * 60_000).toISOString(),
      signed: true,
    });
  };

  addNote('H&P', 'Admission H&P', emr.hAndP ?? emr.admissionExam);
  asStringArray(emr.dailyProgressNotes).forEach((note, index) =>
    addNote('Progress', `Daily Progress Note ${index + 1}`, note, index + 1),
  );
  asStringArray(emr.consultNotes).forEach((note, index) =>
    addNote('Consult', `Consult Note ${index + 1}`, note, index + 10),
  );
  asStringArray(emr.nursingNotes).forEach((note, index) =>
    addNote('Nurse', `Nursing Note ${index + 1}`, note, index + 20),
  );

  return notePayloads;
};

const deriveImagingDetails = (orderName: string) => {
  const normalized = orderName.toLowerCase();
  let studyType = orderName;
  if (normalized.includes('ct')) studyType = 'CT';
  else if (normalized.includes('mri')) studyType = 'MRI';
  else if (normalized.includes('ultrasound')) studyType = 'Ultrasound';
  else if (normalized.includes('echo')) studyType = 'Echocardiogram';
  else if (normalized.includes('x-ray') || normalized.includes('xray')) studyType = 'X-ray';

  let contrast: 'with' | 'without' | null = null;
  if (normalized.includes('with') && normalized.includes('contrast')) contrast = 'with';
  else if (normalized.includes('without') || normalized.includes('no contrast')) contrast = 'without';

  return { studyType, contrast };
};

const initialForm: CaseFormState = {
  specialty: specialtyOptions[0],
  title: '',
  roomNumber: '',
  difficulty: 'easy',
  objectives: '',
  admittingHpi: '',
  hospitalDays: '',
  admitOrders: '',
  admissionVitals: '',
  admissionLabs: '',
  admissionExam: '',
  initialMessage: '',
  bedsideRequirement: 'no',
  patientChatEnabled: false,
  consults: '',
  eventVitals: '',
  nurseExam: '',
  bedsideExam: '',
  typicalQuestions: [''],
  imagingAndOrders: '',
  harmfulActions: [''],
  progressNote: '',
};

export default function CaseBuilder() {
  const { user, profile, activeSchoolId } = useAuthStore();
  const hasAdmin = hasAdminAccess(profile);
  const scopedSchoolId = isSuperAdmin(profile) ? activeSchoolId : profile?.school_id ?? null;

  const [form, setForm] = useState<CaseFormState>(initialForm);
  const [blueprints, setBlueprints] = useState<CaseBlueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generatingSection, setGeneratingSection] = useState<GenerationSection | 'all' | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const fetchBlueprints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('case_blueprints')
        .select('*')
        .order('created_at', { ascending: false });

      if (scopedSchoolId) {
        query = query.eq('school_id', scopedSchoolId);
      }

      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      setBlueprints((data ?? []) as CaseBlueprint[]);
    } catch (err) {
      console.error('Failed to load case blueprints', err);
      setError('Unable to load case blueprints. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [scopedSchoolId]);

  useEffect(() => {
    if (!hasAdmin) return;
    void fetchBlueprints();
  }, [hasAdmin, fetchBlueprints]);

  const handleArrayChange = (key: 'typicalQuestions' | 'harmfulActions', index: number, value: string) => {
    setForm((prev) => {
      const updated = [...prev[key]];
      updated[index] = value;
      return { ...prev, [key]: updated };
    });
  };

  const addArrayItem = (key: 'typicalQuestions' | 'harmfulActions') => {
    setForm((prev) => ({ ...prev, [key]: [...prev[key], ''] }));
  };

  const removeArrayItem = (key: 'typicalQuestions' | 'harmfulActions', index: number) => {
    setForm((prev) => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
  };

  const resetForm = () => {
    setForm((prev) => ({
      ...initialForm,
      specialty: prev.specialty,
      difficulty: prev.difficulty,
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || !hasAdmin) return;
    setSaving(true);
    setError(null);

    try {
      if (!scopedSchoolId) {
        setError('Select a school before saving a case.');
        setSaving(false);
        return;
      }

      const parsedHospitalDays = form.hospitalDays ? parseInt(form.hospitalDays, 10) : null;
      const hospitalDays = Number.isNaN(parsedHospitalDays) ? null : parsedHospitalDays;

      const trimmedQuestions = form.typicalQuestions.map((q) => q.trim()).filter(Boolean);
      const trimmedHarmful = form.harmfulActions.map((q) => q.trim()).filter(Boolean);

      const payload = {
        title: form.title.trim(),
        specialty: form.specialty,
        room_number: form.roomNumber.trim() || null,
        difficulty: form.difficulty,
        objectives: form.objectives.trim(),
        admitting_hpi: form.admittingHpi.trim(),
        hospital_days: hospitalDays,
        admit_orders: form.admitOrders.trim() || null,
        admission_vitals: form.admissionVitals.trim() || null,
        admission_labs: form.admissionLabs.trim() || null,
        admission_exam: form.admissionExam.trim() || null,
        initial_message: form.initialMessage.trim() || null,
        bedside_requirement: form.bedsideRequirement,
        bedside_required: form.bedsideRequirement === 'yes',
        patient_chat_enabled: form.patientChatEnabled,
        consults: form.consults.trim() || null,
        event_vitals: form.eventVitals.trim() || null,
        nurse_exam: form.nurseExam.trim() || null,
        bedside_exam: form.bedsideExam.trim() || null,
        typical_questions: trimmedQuestions.length ? trimmedQuestions : null,
        imaging_and_orders: form.imagingAndOrders.trim() || null,
        harmful_actions: trimmedHarmful.length ? trimmedHarmful : null,
        progress_note: form.progressNote.trim() || null,
        created_by: user.id,
        school_id: scopedSchoolId,
      };

      const { data, error: insertError } = await supabase
        .from('case_blueprints')
        .insert(payload)
        .select()
        .single();

      if (insertError) throw insertError;

      setBlueprints((prev) => [data as CaseBlueprint, ...prev]);
      resetForm();
    } catch (err) {
      console.error('Failed to save case blueprint', err);
      setError('Unable to save this case. Please verify all required fields.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (blueprint: CaseBlueprint) => {
    const generatedPackage = asGeneratedPackage(blueprint.generation_package);
    const bedsideRequirement = getBlueprintBedsideRequirement(blueprint);
    const lines = [
      'Nurse Althea v2 case package input',
      '',
      `Case Title: ${blueprint.title}`,
      `Specialty: ${blueprint.specialty}`,
      `Room Number: ${blueprint.room_number ?? 'Auto-assign if blank'}`,
      `Difficulty: ${difficultyLabels[blueprint.difficulty]}`,
      'Difficulty handling: label only; never change generated content, nurse behavior, or hint strength based on difficulty.',
      `Objectives: ${blueprint.objectives}`,
      `Admitting HPI: ${blueprint.admitting_hpi}`,
      `Days in hospital: ${blueprint.hospital_days ?? 'Auto-generate chart depth from likely course'}`,
      `Consults: ${blueprint.consults ?? 'None'}`,
      `Initial Message: ${blueprint.initial_message ?? '—'}`,
      `Bedside Required: ${bedsideRequirementLabels[bedsideRequirement]}`,
      `Patient Chat at Bedside: ${blueprint.patient_chat_enabled ? 'Enabled when patient can participate' : 'Disabled'}`,
      `Bedside Exam: ${blueprint.bedside_exam ?? '—'}`,
      `Typical Questions: ${(blueprint.typical_questions ?? []).join('; ') || '—'}`,
      `Imaging orders & results required: ${blueprint.imaging_and_orders ?? '—'}`,
      `Unnecessary / Harmful: ${(blueprint.harmful_actions ?? []).join('; ') || '—'}`,
      `Progress Note: ${blueprint.progress_note ?? '—'}`,
      '',
      'Auto-generate from this blueprint:',
      '- Admission vitals, labs, physical exam, and admission orders',
      '- Event-time vitals and nurse observations',
      '- Demographics, allergies, code status, active meds with standard frequencies, I/O, labs, imaging, and orders',
      '- EMR package with H&P, daily progress notes by hospital day, consult notes, and nursing notes',
      '- Nurse chat prompt with short answer-only texting, no suggestions, no diagnosis leakage, and order-gated results',
      '- Bedside package with exam and optional patient voice prompt; disable patient chat for altered, sedated, intubated, or unconscious patients',
      '- Hidden evaluation package with goals, expected workup, harm moves, hints, bedside verdict, and model progress note',
    ];
    if (generatedPackage) {
      lines.push('', 'Generated package preview:', JSON.stringify(generatedPackage, null, 2));
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedId(blueprint.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err) {
      console.error('Failed to copy blueprint', err);
      setError('Copy failed. Please try again.');
    }
  };

  const handleGeneratePackage = async (blueprint: CaseBlueprint, section?: GenerationSection) => {
    setGeneratingId(blueprint.id);
    setGeneratingSection(section ?? 'all');
    setError(null);

    try {
      const { data, error: functionError } = await supabase.functions.invoke('generate-case-package', {
        body: {
          blueprint,
          section: section ?? null,
          existingPackage: asGeneratedPackage(blueprint.generation_package),
        },
      });

      if (functionError) throw functionError;
      const packageData = data?.package as Json | undefined;
      const generatedAt = (data?.generatedAt as string | undefined) ?? new Date().toISOString();
      if (!packageData) throw new Error('No generated package returned');

      const { data: updated, error: updateError } = await supabase
        .from('case_blueprints')
        .update({
          generation_package: packageData,
          generation_status: 'generated',
          generation_error: null,
          generated_at: generatedAt,
        })
        .eq('id', blueprint.id)
        .select()
        .single();

      if (updateError) throw updateError;
      setBlueprints((prev) =>
        prev.map((item) => (item.id === blueprint.id ? (updated as CaseBlueprint) : item))
      );
    } catch (err) {
      console.error('Failed to generate case package', err);
      const message = err instanceof Error ? err.message : 'Generation failed';
      setError(message);
      await supabase
        .from('case_blueprints')
        .update({
          generation_status: 'failed',
          generation_error: message,
        })
        .eq('id', blueprint.id);
      setBlueprints((prev) =>
        prev.map((item) =>
          item.id === blueprint.id
            ? { ...item, generation_status: 'failed', generation_error: message }
            : item
        )
      );
    } finally {
      setGeneratingId(null);
      setGeneratingSection(null);
    }
  };

  const handlePublishRoom = async (blueprint: CaseBlueprint) => {
    if (!scopedSchoolId) {
      setError('Select a school before publishing a room.');
      return;
    }

    const generatedPackage = asGeneratedPackage(blueprint.generation_package);
    if (!generatedPackage) {
      setError('Generate the case package before publishing it to a room.');
      return;
    }

    const roomNumber = blueprint.room_number?.trim();
    if (!roomNumber) {
      setError('Add a room number before publishing this blueprint.');
      return;
    }

    setPublishingId(blueprint.id);
    setError(null);

    try {
      const patient = getGeneratedSection(generatedPackage, 'patient');
      const event = getGeneratedSection(generatedPackage, 'event');
      const orders = getGeneratedSection(generatedPackage, 'orders');
      const bedside = getGeneratedSection(generatedPackage, 'bedside');
      const nurseChat = getGeneratedSection(generatedPackage, 'nurse_chat');
      const evaluation = getGeneratedSection(generatedPackage, 'evaluation');
      const bedsideRequirement = getBlueprintBedsideRequirement(blueprint);
      const generatedAt = blueprint.generated_at ?? new Date().toISOString();

      const emrContextPayload = {
        source: 'case-builder-v2',
        blueprintId: blueprint.id,
        generatedAt,
        package: generatedPackage,
        patientChat: {
          enabled: Boolean(bedside.patientChatEnabled),
          prompt: asString(bedside.patientChatPrompt),
          disableReason: asString(bedside.disableReason),
        },
        evaluation: {
          leniencyMultiplier: 1,
          package: evaluation,
        },
      };

      const roomPayload = {
        room_number: roomNumber,
        role: blueprint.title,
        context: buildRoomText(nurseChat.initialMessage, event.trigger, event.nurseObservations),
        nurse_context: buildRoomText(
          nurseChat.initialMessage,
          nurseChat.behaviorRules,
          nurseChat.knownFacts,
          nurseChat.protectedFacts,
        ),
        emr_context: JSON.stringify(emrContextPayload),
        expected_diagnosis: asString(evaluation.bedsideVerdict),
        expected_treatment: asStringArray(evaluation.expectedWorkup),
        case_goals: asString(evaluation.goals) ?? blueprint.objectives,
        difficulty_level:
          blueprint.difficulty === 'easy'
            ? 'beginner'
            : blueprint.difficulty === 'difficult'
              ? 'advanced'
              : 'intermediate',
        objective: blueprint.objectives,
        progress_note: asString(evaluation.modelProgressNote) ?? blueprint.progress_note,
        example_progress_note: asString(evaluation.modelProgressNote) ?? blueprint.progress_note,
        bedside_hint: buildRoomText(
          bedside.exam,
          bedside.disableReason ? `Patient chat disabled: ${asString(bedside.disableReason)}` : null,
        ) || null,
        bedside_requirement: bedsideRequirement,
        orders_config: {
          generatedOrders: orders,
          admissionOrders: asStringArray(orders.admissionOrders),
          expectedOrders: asStringArray(orders.expectedOrders),
          gatedResults: asStringArray(orders.gatedResults),
          imaging: asStringArray(orders.imaging),
          harmfulOrUnnecessary: asStringArray(orders.harmfulOrUnnecessary),
        },
        school_id: scopedSchoolId,
        created_by: user?.id ?? null,
        is_active: true,
      };

      const { data: existingRoom, error: existingError } = await supabase
        .from('rooms')
        .select('id, patient_id, school_id')
        .eq('room_number', roomNumber)
        .eq('school_id', scopedSchoolId)
        .maybeSingle();

      if (existingError) throw existingError;

      const { data: roomRecord, error: roomError } = existingRoom
        ? await supabase
            .from('rooms')
            .update(roomPayload)
            .eq('id', existingRoom.id)
            .select('id, patient_id, school_id')
            .single()
        : await supabase
            .from('rooms')
            .insert([roomPayload])
            .select('id, patient_id, school_id')
            .single();

      if (roomError || !roomRecord) throw roomError ?? new Error('Room publish failed');

      let patientId = roomRecord.patient_id;
      if (!patientId) {
        const nameText = asString(patient.demographics) ?? `Sim Patient ${roomNumber}`;
        const nameParts = nameText.replace(/[,()]/g, ' ').trim().split(/\s+/);
        const firstName = nameParts[0] || 'Sim';
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : 'Patient';
        const allergies = asStringArray(patient.allergies);

        const { data: patientRecord, error: patientError } = await supabase
          .from('patients')
          .insert([
            {
              room_id: roomRecord.id,
              school_id: scopedSchoolId,
              mrn: `ROOM-${roomNumber}-${Date.now()}`,
              first_name: firstName,
              last_name: lastName,
              date_of_birth: '1990-01-01',
              gender: 'Other',
              admission_date: new Date().toISOString().slice(0, 10),
              service: blueprint.specialty,
              attending_physician: null,
              allergies,
              code_status: asString(patient.codeStatus),
            },
          ])
          .select('id')
          .single();

        if (patientError || !patientRecord) throw patientError ?? new Error('Patient publish failed');
        patientId = patientRecord.id;
        await supabase.from('rooms').update({ patient_id: patientId }).eq('id', roomRecord.id);
      }

      const imagingFailures: string[] = [];
      if (patientId) {
        const generatedImagingOrders = asStringArray(orders.imaging);

        for (const orderName of generatedImagingOrders) {
          const { studyType, contrast } = deriveImagingDetails(orderName);
          const { data: existingStudy, error: existingStudyError } = await supabase
            .from('imaging_studies')
            .select('id, report')
            .eq('patient_id', patientId)
            .eq('room_id', roomRecord.id)
            .eq('order_name', orderName)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingStudyError) throw existingStudyError;
          if (existingStudy?.report) continue;

          const studyId = existingStudy?.id ?? crypto.randomUUID();
          if (!existingStudy) {
            const { error: studyError } = await supabase.from('imaging_studies').insert({
              id: studyId,
              patient_id: patientId,
              room_id: roomRecord.id,
              school_id: scopedSchoolId,
              override_scope: 'room',
              order_name: orderName,
              study_type: studyType,
              contrast,
              priority: 'Routine',
              status: 'Pending',
              ordered_by: 'Case Builder',
              order_time: generatedAt,
              images: [],
            });
            if (studyError) throw studyError;
          } else {
            const { error: resetStudyError } = await supabase
              .from('imaging_studies')
              .update({ status: 'Pending', deleted_at: null })
              .eq('id', studyId);
            if (resetStudyError) throw resetStudyError;
          }

          try {
            const response = await supabase.functions.invoke('imaging-results', {
              body: {
                orderName,
                priority: 'Routine',
                modality: studyType,
                contrast,
                imageNotes: generatedImagingOrders,
                context: {
                  room: { id: roomRecord.id, number: roomNumber },
                  emrContext: emrContextPayload,
                  nurseContext: roomPayload.nurse_context,
                  expectedDiagnosis: roomPayload.expected_diagnosis,
                  expectedTreatment: roomPayload.expected_treatment,
                  caseGoals: roomPayload.case_goals,
                  difficultyLevel: roomPayload.difficulty_level,
                  objective: roomPayload.objective,
                  progressNote: roomPayload.progress_note,
                  completionHint: asString(bedside.completionHint),
                },
              },
            });
            if (response.error) throw response.error;
            const report = (response.data as { report?: string } | null)?.report;
            if (!report) throw new Error('Imaging report missing from response');

            const { error: reportError } = await supabase
              .from('imaging_studies')
              .update({
                report,
                report_generated_at: new Date().toISOString(),
                status: 'Completed',
              })
              .eq('id', studyId);
            if (reportError) throw reportError;
          } catch (error) {
            console.error(`Failed to generate report for ${orderName}`, error);
            imagingFailures.push(orderName);
            await supabase
              .from('imaging_studies')
              .update({ status: 'Failed' })
              .eq('id', studyId);
          }
        }

        const { error: deleteNotesError } = await supabase
          .from('clinical_notes')
          .update({ deleted_at: new Date().toISOString() })
          .eq('patient_id', patientId)
          .eq('room_id', roomRecord.id)
          .eq('override_scope', 'room')
          .eq('author', 'Nurse Althea Generator')
          .is('deleted_at', null);
        if (deleteNotesError) throw deleteNotesError;

        const notePayloads = createClinicalNotePayloads(
          patientId,
          scopedSchoolId,
          roomRecord.id,
          generatedPackage,
        );
        if (notePayloads.length) {
          const { error: noteError } = await supabase.from('clinical_notes').insert(notePayloads);
          if (noteError) throw noteError;
        }
      }

      setError(
        imagingFailures.length
          ? `Published ${blueprint.title} to room ${roomNumber}, but report generation failed for: ${imagingFailures.join(', ')}.`
          : `Published ${blueprint.title} to room ${roomNumber}.`,
      );
    } catch (err) {
      console.error('Failed to publish case blueprint to room', err);
      setError(err instanceof Error ? err.message : 'Unable to publish this generated case to a room.');
    } finally {
      setPublishingId(null);
    }
  };

  const renderGeneratedSection = (section: Record<string, unknown>) => (
    <div className="mt-2 space-y-2">
      {Object.entries(section).map(([key, value]) => (
        <div key={key} className="rounded-md border border-slate-200 bg-white p-2">
          <p className="text-[11px] font-semibold uppercase text-slate-500">{fieldLabel(key)}</p>
          <pre className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700">
            {formatGeneratedValue(value)}
          </pre>
        </div>
      ))}
    </div>
  );

  const easyCount = useMemo(
    () => blueprints.filter((b) => b.difficulty === 'easy').length,
    [blueprints]
  );
  const intermediateCount = useMemo(
    () => blueprints.filter((b) => b.difficulty === 'intermediate').length,
    [blueprints]
  );
  const difficultCount = useMemo(
    () => blueprints.filter((b) => b.difficulty === 'difficult').length,
    [blueprints]
  );

  if (!hasAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AdminLayout>
      <div className="px-6 py-6 space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-700">
              <Wand2 className="h-4 w-4" />
              Nurse Chat Case Builder
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Create admin-side nurse chat cases</h1>
            <p className="text-sm text-slate-600">
              Capture the physician-authored source fields once, then generate the nurse chat,
              EMR, bedside, and evaluation package from one blueprint.
            </p>
          </div>
          <SchoolScopeSelector className="w-full md:w-60" label="School scope" />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mix</p>
            <p className="mt-1 text-sm text-slate-600">
              Aim for six easy, two intermediate, and two difficult cases per batch. Include at
              least two bedside-required encounters.
            </p>
            <div className="mt-3 flex gap-2 text-xs">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                Easy: {easyCount}
              </span>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                Intermediate: {intermediateCount}
              </span>
              <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">
                Difficult: {difficultCount}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timing</p>
            <p className="mt-1 text-sm text-slate-600">
              Difficulty is assignment metadata only. It should never change generated case
              content, nurse behavior, or hint strength.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quality</p>
            <p className="mt-1 text-sm text-slate-600">
              The generated package should keep chat, EMR, bedside, and feedback facts identical
              and avoid foreshadowing the overnight event.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    New case
                  </p>
                  <h2 className="text-lg font-semibold text-slate-900">Case blueprint</h2>
                </div>
                {saving && <Loader2 className="h-5 w-5 animate-spin text-blue-600" />}
              </div>

              {error && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-4 space-y-5">
                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Specialty</label>
                    <select
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      value={form.specialty}
                      onChange={(e) => setForm((prev) => ({ ...prev, specialty: e.target.value }))}
                    >
                      {specialtyOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm font-medium text-slate-700">Case title</label>
                    <input
                      type="text"
                      required
                      value={form.title}
                      onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Example: Fever and agitation after dialysis"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Room number</label>
                    <input
                      type="text"
                      value={form.roomNumber}
                      onChange={(e) => setForm((prev) => ({ ...prev, roomNumber: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="412"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Difficulty</label>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                      {(['easy', 'intermediate', 'difficult'] as CaseBlueprint['difficulty'][]).map(
                        (value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setForm((prev) => ({ ...prev, difficulty: value }))}
                            className={`rounded-md border px-3 py-2 text-left transition ${
                              form.difficulty === value
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                            }`}
                          >
                            {difficultyLabels[value]}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Days in hospital</label>
                    <input
                      type="number"
                      min="0"
                      value={form.hospitalDays}
                      onChange={(e) => setForm((prev) => ({ ...prev, hospitalDays: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Example: 3"
                    />
                    <p className="mt-1 text-xs text-slate-500">Days before the incident occurred.</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Bedside verdict</label>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                      {(['yes', 'no', 'situational'] as BedsideRequirement[]).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, bedsideRequirement: value }))}
                          className={`rounded-md border px-3 py-2 text-left transition ${
                            form.bedsideRequirement === value
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          {bedsideRequirementLabels[value]}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Used by feedback after the case.</p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Objectives / goals</label>
                    <textarea
                      required
                      value={form.objectives}
                      onChange={(e) => setForm((prev) => ({ ...prev, objectives: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="What do you expect the learner to surface or decide?"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Admitting HPI</label>
                    <textarea
                      required
                      value={form.admittingHpi}
                      onChange={(e) => setForm((prev) => ({ ...prev, admittingHpi: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Include hospital course if relevant."
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Consults</label>
                    <textarea
                      value={form.consults}
                      onChange={(e) => setForm((prev) => ({ ...prev, consults: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Cardiology for NSTEMI risk stratification; Ortho for post-op weight bearing."
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Each specialty/reason becomes a generated consult note in the EMR package.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Bedside patient chat</label>
                    <label className="mt-2 flex items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.patientChatEnabled}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, patientChatEnabled: e.target.checked }))
                        }
                        className="mt-1 text-blue-600"
                      />
                      <span>
                        Generate a bedside patient chat prompt when the patient is alert enough to
                        participate.
                      </span>
                    </label>
                    <p className="mt-1 text-xs text-slate-500">
                      The generator should auto-disable chat for altered, sedated, intubated, or
                      unconscious patients.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  <p className="font-semibold">Auto-generated from the blueprint</p>
                  <p className="mt-1">
                    Admission vitals/labs/exam/orders, event vitals, nurse observations,
                    demographics, active meds, I/O, daily labs, notes, and gated post-event
                    results should come from the generation pipeline unless a legacy override is
                    filled below.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Admission vitals override</label>
                    <input
                      type="text"
                      value={form.admissionVitals}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, admissionVitals: e.target.value }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Optional legacy override"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Admission labs override</label>
                    <input
                      type="text"
                      value={form.admissionLabs}
                      onChange={(e) => setForm((prev) => ({ ...prev, admissionLabs: e.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Optional legacy override"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Admission physical exam override</label>
                    <textarea
                      value={form.admissionExam}
                      onChange={(e) => setForm((prev) => ({ ...prev, admissionExam: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Optional legacy override"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Admit orders override</label>
                    <textarea
                      value={form.admitOrders}
                      onChange={(e) => setForm((prev) => ({ ...prev, admitOrders: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Optional legacy override"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Initial message</label>
                    <textarea
                      value={form.initialMessage}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, initialMessage: e.target.value }))
                      }
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="How does the nurse open the chat?"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Event vitals override</label>
                    <textarea
                      value={form.eventVitals}
                      onChange={(e) => setForm((prev) => ({ ...prev, eventVitals: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Optional legacy override"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Nurse observations override</label>
                    <textarea
                      value={form.nurseExam}
                      onChange={(e) => setForm((prev) => ({ ...prev, nurseExam: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Optional legacy override"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Bedside exam (if required)</label>
                    <textarea
                      value={form.bedsideExam}
                      onChange={(e) => setForm((prev) => ({ ...prev, bedsideExam: e.target.value }))}
                      className="mt-1 h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="What the learner sees when they go in person."
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Typical questions</label>
                    <div className="space-y-2">
                      {form.typicalQuestions.map((question, index) => (
                        <div key={`question-${index}`} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={question}
                            onChange={(e) =>
                              handleArrayChange('typicalQuestions', index, e.target.value)
                            }
                            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="What you expect the learner to ask"
                          />
                          {form.typicalQuestions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeArrayItem('typicalQuestions', index)}
                              className="text-slate-400 hover:text-rose-600"
                              aria-label="Remove question"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addArrayItem('typicalQuestions')}
                        className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800"
                      >
                        <Plus className="h-4 w-4" /> Add question
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Imaging / orders + results</label>
                    <textarea
                      value={form.imagingAndOrders}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, imagingAndOrders: e.target.value }))
                      }
                      className="mt-1 h-28 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Orders to place and the answers they should see."
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Unnecessary / harmful moves</label>
                    <div className="space-y-2">
                      {form.harmfulActions.map((action, index) => (
                        <div key={`harmful-${index}`} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={action}
                            onChange={(e) => handleArrayChange('harmfulActions', index, e.target.value)}
                            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="Orders that are misguided or unsafe"
                          />
                          {form.harmfulActions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeArrayItem('harmfulActions', index)}
                              className="text-slate-400 hover:text-rose-600"
                              aria-label="Remove harmful action"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addArrayItem('harmfulActions')}
                        className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-800"
                      >
                        <Plus className="h-4 w-4" /> Add harmful action
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700">Progress note (3 sentences)</label>
                    <textarea
                      value={form.progressNote}
                      onChange={(e) => setForm((prev) => ({ ...prev, progressNote: e.target.value }))}
                      className="mt-1 h-28 w-full rounded-md border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Short note summarizing what happened in the case."
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Clear draft
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save case
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Library
                  </p>
                  <h2 className="text-lg font-semibold text-slate-900">Saved blueprints</h2>
                </div>
                {loading && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
              </div>

              {blueprints.length === 0 && !loading ? (
                <p className="mt-4 text-sm text-slate-600">
                  No cases yet. Add a blueprint and it will appear here for reuse and copy/paste.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {blueprints.map((blueprint) => (
                    (() => {
                      const generatedPackage = asGeneratedPackage(blueprint.generation_package);
                      const isGenerating = generatingId === blueprint.id;
                      const isPublishing = publishingId === blueprint.id;

                      return (
                        <div
                          key={blueprint.id}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-wide text-slate-500">
                                {blueprint.specialty}
                              </p>
                              <h3 className="text-base font-semibold text-slate-900">
                                {blueprint.title}
                              </h3>
                              <p className="text-xs text-slate-500">
                                {difficultyLabels[blueprint.difficulty]} •{' '}
                                Bedside {bedsideRequirementLabels[getBlueprintBedsideRequirement(blueprint)]}
                                {blueprint.room_number ? ` • Room ${blueprint.room_number}` : ''}
                              </p>
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                type="button"
                                disabled={isGenerating}
                                onClick={() => handleGeneratePackage(blueprint)}
                                className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm transition hover:border-blue-300 disabled:cursor-not-allowed disabled:text-blue-400"
                              >
                                {isGenerating && generatingSection === 'all' ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Wand2 className="h-4 w-4" />
                                )}
                                {generatedPackage ? 'Regenerate' : 'Generate'}
                              </button>
                              <button
                                type="button"
                                disabled={!generatedPackage || isPublishing}
                                onClick={() => {
                                  void handlePublishRoom(blueprint);
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300 disabled:cursor-not-allowed disabled:text-emerald-400"
                              >
                                {isPublishing ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <UploadCloud className="h-4 w-4" />
                                )}
                                Publish
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopy(blueprint)}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"
                              >
                                {copiedId === blueprint.id ? (
                                  <>
                                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <ClipboardCopy className="h-4 w-4" />
                                    Copy
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                          <p className="mt-2 text-sm text-slate-700">
                            {blueprint.objectives}
                          </p>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                            <div>
                              <span className="font-semibold text-slate-800">Consults:</span>{' '}
                              {blueprint.consults ?? '—'}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-800">Progress note:</span>{' '}
                              {blueprint.progress_note ?? '—'}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-800">Required orders/results:</span>{' '}
                              {blueprint.imaging_and_orders ?? '—'}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-800">Harmful:</span>{' '}
                              {(blueprint.harmful_actions ?? []).join('; ') || '—'}
                            </div>
                          </div>

                          <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1 font-medium text-slate-800">
                                <FileText className="h-4 w-4 text-blue-600" />
                                Generated package
                              </span>
                              <span>
                                {blueprint.generation_status === 'generated' && blueprint.generated_at
                                  ? `Updated ${new Date(blueprint.generated_at).toLocaleString()}`
                                  : blueprint.generation_status === 'failed'
                                    ? 'Generation failed'
                                    : 'Not generated'}
                              </span>
                            </div>
                            {blueprint.generation_error && (
                              <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-rose-700">
                                {blueprint.generation_error}
                              </p>
                            )}
                          </div>

                          {generatedPackage && (
                            <div className="mt-3 space-y-3">
                              {generationSections.map((section) => {
                                const sectionValue = generatedPackage[section.key];
                                if (!sectionValue) return null;
                                const isSectionGenerating =
                                  isGenerating && generatingSection === section.key;

                                return (
                                  <details
                                    key={section.key}
                                    className="rounded-md border border-slate-200 bg-slate-100 p-3"
                                  >
                                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-slate-800">
                                      <span>{section.label}</span>
                                      <button
                                        type="button"
                                        disabled={isGenerating}
                                        onClick={(event) => {
                                          event.preventDefault();
                                          void handleGeneratePackage(blueprint, section.key);
                                        }}
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-slate-400"
                                      >
                                        {isSectionGenerating ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <RefreshCw className="h-3.5 w-3.5" />
                                        )}
                                        Regen
                                      </button>
                                    </summary>
                                    {renderGeneratedSection(sectionValue)}
                                  </details>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
