import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { useAuthStore } from '../stores/authStore';
import { getSchoolDisplayName, useSchools } from '../hooks/useSchools';
import { hasAdminAccess, isSuperAdmin } from '../lib/roles';
import { isObgynSpecialtyName } from '../lib/roomHelpers';
import { instantLabs, pendingLabs } from '../features/emr/lib/labCatalog';
import type { RoomOrdersConfig } from '../features/emr/lib/types';
import { LEARNER_PROGRAMS, type LearnerProgram } from '../lib/programTracks';
import { DEFAULT_HOSPITAL_TIMELINE, hospitalTimelineChanged, mergeHospitalTimelineIntoNurseContext, parseHospitalTimeline, timelineTrend, validateHospitalTimeline, type EncounterType, type HospitalTimeline } from '../lib/hospitalTimeline';
import { HospitalTimelineEditor } from './HospitalTimelineEditor';
import { mergePatientChatContext, normalizePatientResponseMode } from '../lib/patientChatPersistence';
import { buildContextOnlyEmrPayload, buildContextOnlyRoomUpdate, parseRoomEmrContext } from '../lib/roomEditorPersistence';
import { buildConversationPromptPatch, resolveAuthoredConversationPrompt, type ConversationPromptKind } from '../lib/conversationPrompts';
import { preserveOrdersConfig } from '../lib/ordersConfig';

type Room = Database['public']['Tables']['rooms']['Row'];
type Specialty = Database['public']['Tables']['specialties']['Row'];
type AdmissionLabEntry = {
  labName: string;
  note: string;
  value?: string;
  unit?: string;
  referenceRange?: string;
  status?: string;
};

type CompletionHints = {
  assessmentHint: string;
  diagnosisDifferentiatorHint: string;
  planHint: string;
};

type BedsideRequirement = 'yes' | 'no' | 'situational';

const bedsideRequirementOptions: Array<{ value: BedsideRequirement; label: string }> = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'situational', label: 'Situational' },
];

const normalizeBedsideRequirement = (value: unknown): BedsideRequirement => {
  if (value === 'yes' || value === 'no' || value === 'situational') return value;
  return 'situational';
};

const normalizeEvaluationLeniencyMultiplier = (value: number | null | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 1;
  return Math.max(0.75, Math.min(1.5, Number(value.toFixed(2))));
};

const parseCompletionHints = (raw: string | null | undefined): CompletionHints => {
  const empty = {
    assessmentHint: '',
    diagnosisDifferentiatorHint: '',
    planHint: '',
  };
  if (!raw?.trim()) return empty;

  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as Partial<CompletionHints>;
    if (parsed && typeof parsed === 'object') {
      return {
        assessmentHint: String(parsed.assessmentHint ?? ''),
        diagnosisDifferentiatorHint: String(parsed.diagnosisDifferentiatorHint ?? ''),
        planHint: String(parsed.planHint ?? ''),
      };
    }
  } catch {
    // Continue to plain-text parsing.
  }

  const lines = trimmed.split('\n');
  const next = { ...empty };
  lines.forEach((line) => {
    const [label, ...rest] = line.split(':');
    if (!label || rest.length === 0) return;
    const value = rest.join(':').trim();
    const normalizedLabel = label.trim().toLowerCase();
    if (normalizedLabel.includes('assessment') || normalizedLabel.includes('attending')) {
      next.assessmentHint = value;
    } else if (normalizedLabel.includes('diagnosis')) {
      next.diagnosisDifferentiatorHint = value;
    } else if (normalizedLabel.includes('plan')) {
      next.planHint = value;
    }
  });

  if (next.assessmentHint || next.diagnosisDifferentiatorHint || next.planHint) {
    return next;
  }

  return {
    ...empty,
    assessmentHint: trimmed,
  };
};

const buildCompletionHintPayload = (hints: CompletionHints): string | null => {
  const parts = [
    hints.assessmentHint.trim() ? `Assessment Hint: ${hints.assessmentHint.trim()}` : '',
    hints.diagnosisDifferentiatorHint.trim()
      ? `Diagnosis Differentiator Hint: ${hints.diagnosisDifferentiatorHint.trim()}`
      : '',
    hints.planHint.trim() ? `Plan Hint: ${hints.planHint.trim()}` : '',
  ].filter(Boolean);

  if (!parts.length) return null;
  return parts.join('\n');
};

interface RoomEditorProps {
  room?: Room;
  onSave: () => void;
  onCancel: () => void;
  onRoomPatch?: (patch: Partial<Room>) => void;
}

export default function RoomEditor({ room, onSave, onCancel, onRoomPatch }: RoomEditorProps) {
  const { profile, activeSchoolId } = useAuthStore();
  const { schools } = useSchools();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [patientPromptStatus, setPatientPromptStatus] = useState('');
  const [consultantPromptStatus, setConsultantPromptStatus] = useState('');
  const [promptPreview, setPromptPreview] = useState<ConversationPromptKind | null>(null);
  const [timelineWarning, setTimelineWarning] = useState<string>('');
  const advancedSettingsVisible = false;
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  
  // Form state
  const [roomNumber, setRoomNumber] = useState(room?.room_number || '');
  const [learnerProgram, setLearnerProgram] = useState<LearnerProgram>(
    room?.learner_program === 'nursing' ? 'nursing' : 'medical',
  );
  const [role, setRole] = useState(room?.role || '');
  const [objective, setObjective] = useState(room?.objective || '');
  const [style, setStyle] = useState(room?.style || '');
  const [patientName, setPatientName] = useState('');
  const [nurseContext, setNurseContext] = useState(room?.nurse_context || room?.context || '');
  const parsedEmrContext = (() => {
    const raw = room?.emr_context;
    const parsed = parseRoomEmrContext(raw);
    let contextText = typeof parsed.context === 'string' ? parsed.context : (typeof raw === 'string' ? raw : '');
    let admissionLabs: AdmissionLabEntry[] = [];
    let deliveryNote = '';
    let evaluationLeniencyMultiplier = 1;
    let generatedPatientPrompt = '';
    let generatedPatientResponseMode: 'responsive' | 'unable' = 'responsive';
    let generatedConsultantPrompt = '';
    if (Object.keys(parsed).length > 0) {
          if (typeof parsed.context === 'string') {
            contextText = parsed.context;
          }
          const labs = (parsed as { admission?: { labs?: AdmissionLabEntry[] } })?.admission?.labs;
          if (Array.isArray(labs)) {
            admissionLabs = labs
              .filter((entry) => entry && (entry.labName || entry.note || entry.value))
              .map((entry) => ({
                labName: entry.labName || '',
                note: entry.note || '',
                value: entry.value ?? '',
                unit: entry.unit ?? '',
                referenceRange: entry.referenceRange ?? '',
                status: entry.status ?? '',
              }));
          }
          if (typeof (parsed as { delivery_note?: unknown }).delivery_note === 'string') {
            deliveryNote = (parsed as { delivery_note: string }).delivery_note;
          }
          const generated = parsed as {
            patientChat?: { prompt?: unknown };
            patient_conversation_prompt?: unknown;
            consultantResponsePrompt?: unknown;
            consultant_response_prompt?: unknown;
          };
          if (typeof generated.patientChat?.prompt === 'string') generatedPatientPrompt = generated.patientChat.prompt;
          if (typeof generated.patient_conversation_prompt === 'string') generatedPatientPrompt = generated.patient_conversation_prompt;
          if (typeof generated.consultantResponsePrompt === 'string') generatedConsultantPrompt = generated.consultantResponsePrompt;
          if (typeof generated.consultant_response_prompt === 'string') generatedConsultantPrompt = generated.consultant_response_prompt;
          const patientChat = (parsed as { patientChat?: { responseMode?: unknown } }).patientChat;
          generatedPatientResponseMode = normalizePatientResponseMode(patientChat?.responseMode ?? (parsed as { patientResponseMode?: unknown }).patientResponseMode);
          const rawLeniency = (parsed as {
            evaluation?: { leniencyMultiplier?: unknown };
          }).evaluation?.leniencyMultiplier;
          if (typeof rawLeniency === 'number') {
            evaluationLeniencyMultiplier = normalizeEvaluationLeniencyMultiplier(rawLeniency);
          } else if (typeof rawLeniency === 'string') {
            evaluationLeniencyMultiplier = normalizeEvaluationLeniencyMultiplier(Number(rawLeniency));
          }
    }
    return { contextText, admissionLabs, deliveryNote, evaluationLeniencyMultiplier, generatedPatientPrompt, generatedConsultantPrompt, generatedPatientResponseMode };
  })();
  const [emrContext, setEmrContext] = useState(parsedEmrContext.contextText);
  const roomWithTimeline = room as (Room & { encounter_type?: EncounterType; hospital_stay_days?: number; hospital_timeline?: unknown }) | undefined;
  const originalHospitalTimeline = parseHospitalTimeline(roomWithTimeline?.hospital_timeline ?? DEFAULT_HOSPITAL_TIMELINE);
  const originalTimelineWithRoomSettings: HospitalTimeline = {
    ...originalHospitalTimeline,
    encounterType: roomWithTimeline?.encounter_type ?? originalHospitalTimeline.encounterType,
    stayDays: roomWithTimeline?.hospital_stay_days ?? originalHospitalTimeline.stayDays,
  };
  const [encounterType, setEncounterType] = useState<EncounterType>(roomWithTimeline?.encounter_type ?? 'inpatient');
  const [hospitalStayDays, setHospitalStayDays] = useState(String(roomWithTimeline?.hospital_stay_days ?? 1));
  const initialHospitalTimelineText = JSON.stringify(parseHospitalTimeline(roomWithTimeline?.hospital_timeline ?? DEFAULT_HOSPITAL_TIMELINE), null, 2);
  const [hospitalTimelineText, setHospitalTimelineText] = useState(initialHospitalTimelineText);
  const [deliveryNote, setDeliveryNote] = useState(parsedEmrContext.deliveryNote);
  const [evaluationLeniencyMultiplier, setEvaluationLeniencyMultiplier] = useState(
    String(parsedEmrContext.evaluationLeniencyMultiplier),
  );
  const admissionLabs = parsedEmrContext.admissionLabs;
  const [caseGoals, setCaseGoals] = useState(room?.case_goals || '');
  const [progressNote, setProgressNote] = useState(room?.progress_note || '');
  const parsedCompletionHints = parseCompletionHints(room?.completion_hint ?? '');
  const [assessmentHint, setAssessmentHint] = useState(parsedCompletionHints.assessmentHint);
  const [diagnosisDifferentiatorHint, setDiagnosisDifferentiatorHint] = useState(
    parsedCompletionHints.diagnosisDifferentiatorHint,
  );
  const [planHint, setPlanHint] = useState(parsedCompletionHints.planHint);
  const [bedsideHint, setBedsideHint] = useState(room?.bedside_hint || '');
  const [patientConversationPrompt, setPatientConversationPrompt] = useState(
    room?.patient_conversation_prompt || parsedEmrContext.generatedPatientPrompt || '',
  );
  const [patientConversationEnabled, setPatientConversationEnabled] = useState(
    room?.patient_conversation_enabled ?? Boolean(room?.patient_conversation_prompt),
  );
  const [patientResponseMode, setPatientResponseMode] = useState<'responsive' | 'unable'>(parsedEmrContext.generatedPatientResponseMode);
  const [consultantResponsePrompt, setConsultantResponsePrompt] = useState(
    room?.consultant_response_prompt || parsedEmrContext.generatedConsultantPrompt || '',
  );
  const consultantPromptReady = consultantResponsePrompt.trim().length > 0;
  const [bedsideRequirement, setBedsideRequirement] = useState<BedsideRequirement>(
    normalizeBedsideRequirement(room?.bedside_requirement),
  );
  const normalVitals = {
    temperature: 98.6,
    blood_pressure_systolic: 120,
    blood_pressure_diastolic: 80,
    heart_rate: 80,
    respiratory_rate: 16,
    oxygen_saturation: 98,
  };
  const vitalEntries = (() => {
    if (room?.initial_vitals && typeof room.initial_vitals === 'object') {
      return Object.entries(room.initial_vitals as Record<string, unknown>).map(([key, value]) => ({
        key,
        value: value === null || typeof value === 'undefined' ? '' : String(value),
      }));
    }
    return [];
  })();
  
  // Advanced settings
  const initialSpecialtyIds = (() => {
    const ids = new Set<string>();
    if (room?.specialty_id) ids.add(room.specialty_id);
    if (Array.isArray(room?.specialty_ids)) {
      room.specialty_ids.forEach((id) => {
        if (id) ids.add(id);
      });
    }
    return Array.from(ids);
  })();
  const [specialtyIds, setSpecialtyIds] = useState<string[]>(initialSpecialtyIds);
  const isObgynRoom = specialtyIds.some((id) => {
    const specialty = specialties.find((item) => item.id === id);
    return isObgynSpecialtyName(specialty?.name);
  });
  const [difficultyLevel, setDifficultyLevel] = useState<'beginner' | 'intermediate' | 'advanced' | null>(
    room?.difficulty_level || null
  );
  const [expectedDiagnosis, setExpectedDiagnosis] = useState(room?.expected_diagnosis || '');
  const [expectedTreatment, setExpectedTreatment] = useState<string[]>(room?.expected_treatment || []);
  const buildDefaultOrdersConfig = (): RoomOrdersConfig => ({
    labs: [...instantLabs, ...pendingLabs].map((name) => ({
      name,
      type: instantLabs.includes(name) ? 'instant' : 'pending',
      statByDefault: instantLabs.includes(name),
    })),
    notes: '',
  });

  const initialOrdersConfig = (() => {
    const raw = room?.orders_config as RoomOrdersConfig | null | undefined;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return preserveOrdersConfig(raw);
    }
    return buildDefaultOrdersConfig();
  })();
  const [ordersConfig, setOrdersConfig] = useState<RoomOrdersConfig>(initialOrdersConfig);
  const [isActive, setIsActive] = useState(room?.is_active ?? true);
  const [continuesFrom, setContinuesFrom] = useState<string>(room?.continues_from ? String(room.continues_from) : '');
  const [roomOptions, setRoomOptions] = useState<Array<{ id: number; room_number: string }>>([]);
  const scopedSchoolId = isSuperAdmin(profile)
    ? room?.school_id ?? activeSchoolId ?? null
    : profile?.school_id ?? room?.school_id ?? null;
  const [schoolId, setSchoolId] = useState<string>(() => scopedSchoolId ?? '');
  // Check if room is available to all schools (empty array or all school IDs)
  const isAllSchools = (() => {
    if (!room?.available_school_ids) return false;
    if (room.available_school_ids.length === 0) return true;
    return false;
  })();

  const initialAvailableSchoolIds = (() => {
    const ids = new Set<string>();
    if (room?.school_id) ids.add(room.school_id);
    if (Array.isArray(room?.available_school_ids)) {
      room.available_school_ids.forEach((id) => {
        if (id) ids.add(id);
      });
    }
    if (scopedSchoolId) ids.add(scopedSchoolId);
    return Array.from(ids);
  })();
  const [availableSchoolIds, setAvailableSchoolIds] = useState<string[]>(initialAvailableSchoolIds);
  const [allSchoolsSelected, setAllSchoolsSelected] = useState(isAllSchools);
  const pdfUrl = room?.pdf_url ?? null;
  const buildInitialLabResults = (patientId: string, schoolId?: string | null) => {
    // Use consolidated baseline timestamp for all initial labs
    const baselineTimestamp = '2000-01-01T00:00:00.000Z';
    const baseFields = {
      patient_id: patientId,
      room_id: null, // Always null for consolidated baseline labs
      assignment_id: null,
      override_scope: 'baseline' as const, // Always baseline for consolidation
      school_id: schoolId ?? null,
      collection_time: baselineTimestamp,
      result_time: baselineTimestamp,
      ordered_by: 'EMR Auto',
    };
    return [
      {
        ...baseFields,
        test_name: 'Hemoglobin',
        value: 13.5,
        unit: 'g/dL',
        reference_range: '12.0-15.5',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'White Blood Cell Count',
        value: 8.1,
        unit: 'K/uL',
        reference_range: '4.0-11.0',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'Platelets',
        value: 245,
        unit: 'K/uL',
        reference_range: '150-400',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'Sodium',
        value: 138,
        unit: 'mmol/L',
        reference_range: '135-145',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'Potassium',
        value: 4.1,
        unit: 'mmol/L',
        reference_range: '3.5-5.1',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'Creatinine',
        value: 1.0,
        unit: 'mg/dL',
        reference_range: '0.7-1.3',
        status: 'Normal',
      },
      {
        ...baseFields,
        test_name: 'Glucose',
        value: 95,
        unit: 'mg/dL',
        reference_range: '70-110',
        status: 'Normal',
      },
    ];
  };

  useEffect(() => {
    let isMounted = true;

    const loadSpecialties = async () => {
      if (!schoolId) return;

      try {
        const { data, error } = await supabase
          .from('specialties')
          .select('*')
          .or('school_id.is.null,school_id.eq.' + schoolId)
          .order('name');

        if (error) {
          console.error('Error fetching specialties:', error);
          return;
        }

        if (isMounted) {
          setSpecialties(data || []);
        }
      } catch (err) {
        console.error('Error fetching specialties:', err);
      }
    };

    void loadSpecialties();

    return () => {
      isMounted = false;
    };
  }, [schoolId]);

  useEffect(() => {
    if (scopedSchoolId && scopedSchoolId !== schoolId) {
      setSchoolId(scopedSchoolId);
    }
  }, [scopedSchoolId, schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    setAvailableSchoolIds((prev) => (prev.includes(schoolId) ? prev : [...prev, schoolId]));
  }, [schoolId]);

  useEffect(() => {
    const fetchRooms = async () => {
      const { data, error } = await supabase.from('rooms').select('id, room_number').order('room_number');
      if (error) {
        console.error('Error fetching rooms list', error);
        return;
      }
      if (data) {
        setRoomOptions(
          data
            .filter((r) => !room || r.id !== room.id)
            .map((r) => ({ id: r.id, room_number: r.room_number })),
        );
      }
    };
    void fetchRooms();
  }, [room]);

  const handleContextOnlySave = async () => {
    if (!room?.id) {
      setError('Save the room before saving EMR context independently.');
      return;
    }
    const finalSchoolId = schoolId || scopedSchoolId;
    if (!finalSchoolId) {
      setError('A school is required to save EMR context.');
      return;
    }
    if (isLoading) return;
    setIsLoading(true);
    setError('');
    try {
      const { error: contextError } = await supabase
        .from('rooms')
        .update({ emr_context: buildContextOnlyEmrPayload(room.emr_context, emrContext) })
        .eq('id', room.id);
      if (contextError) throw contextError;
      onSave();
    } catch (saveError) {
      console.error('Error saving EMR context:', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Failed to save EMR context. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const saveConversationPrompt = async (kind: ConversationPromptKind) => {
    if (!room?.id) {
      const message = 'Save the room once before saving a conversation prompt independently.';
      if (kind === 'patient') setPatientPromptStatus(message); else setConsultantPromptStatus(message);
      return;
    }
    const setStatus = kind === 'patient' ? setPatientPromptStatus : setConsultantPromptStatus;
    const value = kind === 'patient' ? patientConversationPrompt : consultantResponsePrompt;
    setStatus('Saving…');
    setError('');
    try {
      const patch = buildConversationPromptPatch(kind, value);
      const column = kind === 'patient' ? 'patient_conversation_prompt' : 'consultant_response_prompt';
      const { data, error: saveError } = await supabase
        .from('rooms')
        .update(patch)
        .eq('id', room.id)
        .select(column)
        .single();
      if (saveError) throw saveError;
      const saved = resolveAuthoredConversationPrompt(data as Record<string, unknown>, kind);
      if (kind === 'patient') setPatientConversationPrompt(saved);
      else setConsultantResponsePrompt(saved);
      onRoomPatch?.({ [column]: saved || null } as Partial<Room>);
      setStatus(`Saved and read back${room.updated_at ? ` · room revision ${new Date(room.updated_at).toLocaleString()}` : ''}`);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to save this conversation prompt.';
      setStatus(`Save failed: ${message}`);
    }
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    setError('');

    try {
      const finalSchoolId = schoolId || scopedSchoolId;

      if (!finalSchoolId) {
        setError('Please select a school before saving this room.');
        setIsLoading(false);
        return;
      }
      const finalPdfUrl = pdfUrl;

      // Build the same snapshot shape on both sides. Stable structural
      // comparison avoids false full-form saves caused by JSON property order.
      const currentNonContextSnapshot = {
        roomNumber, learnerProgram, role, objective, style, patientName, nurseContext, caseGoals, progressNote,
        assessmentHint, diagnosisDifferentiatorHint, planHint, bedsideHint, patientConversationPrompt,
        patientConversationEnabled, patientResponseMode, consultantResponsePrompt, bedsideRequirement,
        specialtyIds, difficultyLevel, expectedDiagnosis, expectedTreatment, ordersConfig, isActive, continuesFrom,
        schoolId, availableSchoolIds, allSchoolsSelected, encounterType, hospitalStayDays,
        hospitalTimelineText, deliveryNote, evaluationLeniencyMultiplier,
      };
      const originalNonContextSnapshot = {
        roomNumber: room?.room_number || '', learnerProgram: room?.learner_program === 'nursing' ? 'nursing' : 'medical',
        role: room?.role || '', objective: room?.objective || '', style: room?.style || '', patientName: '',
        nurseContext: room?.nurse_context || room?.context || '', caseGoals: room?.case_goals || '',
        progressNote: room?.progress_note || '', assessmentHint: parsedCompletionHints.assessmentHint,
        diagnosisDifferentiatorHint: parsedCompletionHints.diagnosisDifferentiatorHint,
        planHint: parsedCompletionHints.planHint, bedsideHint: room?.bedside_hint || '',
        patientConversationPrompt: room?.patient_conversation_prompt || parsedEmrContext.generatedPatientPrompt || '',
        patientConversationEnabled: room?.patient_conversation_enabled ?? Boolean(room?.patient_conversation_prompt),
        patientResponseMode: parsedEmrContext.generatedPatientResponseMode,
        consultantResponsePrompt: room?.consultant_response_prompt || parsedEmrContext.generatedConsultantPrompt || '',
        bedsideRequirement: normalizeBedsideRequirement(room?.bedside_requirement), specialtyIds: initialSpecialtyIds,
        difficultyLevel: room?.difficulty_level || null, expectedDiagnosis: room?.expected_diagnosis || '',
        expectedTreatment: room?.expected_treatment || [], ordersConfig: initialOrdersConfig,
        isActive: room?.is_active ?? true, continuesFrom: room?.continues_from ? String(room.continues_from) : '',
        schoolId: scopedSchoolId ?? '', availableSchoolIds: initialAvailableSchoolIds, allSchoolsSelected: isAllSchools,
        encounterType: roomWithTimeline?.encounter_type ?? 'inpatient',
        hospitalStayDays: String(roomWithTimeline?.hospital_stay_days ?? 1), hospitalTimelineText: initialHospitalTimelineText,
        deliveryNote: parsedEmrContext.deliveryNote, evaluationLeniencyMultiplier: String(parsedEmrContext.evaluationLeniencyMultiplier),
      };
      const contextOnlyUpdate = room
        ? buildContextOnlyRoomUpdate(room.emr_context, emrContext, currentNonContextSnapshot, originalNonContextSnapshot)
        : null;
      if (contextOnlyUpdate && room) {
        const { error: contextError } = await supabase.from('rooms').update(contextOnlyUpdate).eq('id', room.id);
        if (contextError) throw contextError;
        onSave();
        return;
      }

      let hospitalTimeline: HospitalTimeline;
      try {
        hospitalTimeline = parseHospitalTimeline(JSON.parse(hospitalTimelineText));
      } catch {
        throw new Error('Hospital timeline must be valid JSON.');
      }
      hospitalTimeline = { ...hospitalTimeline, encounterType, stayDays: Number(hospitalStayDays) };
      const timelineErrors = validateHospitalTimeline(hospitalTimeline);
      if (timelineErrors.length) throw new Error(timelineErrors.join(' '));

      const initialVitals = vitalEntries.reduce<Record<string, unknown>>((acc, entry) => {
        const key = entry.key.trim();
        if (!key) return acc;
        const rawValue = entry.value.trim();
        if (!rawValue) return acc;
        const numericValue = Number(rawValue);
        acc[key] = Number.isNaN(numericValue) ? rawValue : numericValue;
        return acc;
      }, { ...normalVitals });

      const cleanedAdmissionLabs = admissionLabs
        .map((entry) => ({
          labName: entry.labName.trim(),
          note: entry.note.trim(),
          value: entry.value?.toString().trim() || undefined,
          unit: entry.unit?.trim() || undefined,
          referenceRange: entry.referenceRange?.trim() || undefined,
          status: entry.status?.trim() || undefined,
        }))
        .filter((entry) => entry.labName || entry.note || entry.value);

      let existingEmrContext: Record<string, unknown> = {};
      if (typeof room?.emr_context === 'string') {
        try {
          const parsed = JSON.parse(room.emr_context);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existingEmrContext = parsed as Record<string, unknown>;
        } catch {
          // Rebuild only malformed legacy JSON; valid nested fields are preserved below.
        }
      }
      const emrContextPayloadObject: Record<string, unknown> = mergePatientChatContext(existingEmrContext, patientResponseMode);
      if (cleanedAdmissionLabs.length > 0) {
        emrContextPayloadObject.admission = { labs: cleanedAdmissionLabs };
      }
      if (emrContext.trim()) {
        emrContextPayloadObject.context = emrContext.trim();
      }
      if (isObgynRoom && deliveryNote.trim()) {
        emrContextPayloadObject.delivery_note = deliveryNote.trim();
      }
      if (initialVitals) {
        emrContextPayloadObject.initial_vitals = initialVitals;
      }
      const normalizedLeniencyMultiplier = normalizeEvaluationLeniencyMultiplier(
        Number.parseFloat(evaluationLeniencyMultiplier),
      );
      if (normalizedLeniencyMultiplier !== 1) {
        emrContextPayloadObject.evaluation = {
          leniencyMultiplier: normalizedLeniencyMultiplier,
        };
      }

      const emrContextPayload =
        Object.keys(emrContextPayloadObject).length > 0 ? JSON.stringify(emrContextPayloadObject) : null;

      // Normalize school IDs for saving
      // - "All Schools" selected: save empty array []
      // - "All Schools" NOT selected: save array with primary + selected schools
      const normalizedSchoolIds = allSchoolsSelected
        ? []
        : Array.from(new Set([...(availableSchoolIds ?? []), finalSchoolId])).filter(Boolean);

      const completionHintPayload = buildCompletionHintPayload({
        assessmentHint,
        diagnosisDifferentiatorHint,
        planHint,
      });

      const roomData = {
        room_number: roomNumber,
        learner_program: learnerProgram,
        role,
        objective,
        context: mergeHospitalTimelineIntoNurseContext(nurseContext, hospitalTimeline),
        nurse_context: mergeHospitalTimelineIntoNurseContext(nurseContext, hospitalTimeline),
        emr_context: emrContextPayload,
        style,
        specialty_id: specialtyIds[0] ?? null,
        specialty_ids: specialtyIds.length > 0 ? specialtyIds : null,
        difficulty_level: difficultyLevel,
        expected_diagnosis: expectedDiagnosis || null,
        expected_treatment: expectedTreatment.length > 0 ? expectedTreatment : null,
        case_goals: caseGoals || null,
        progress_note: progressNote || null,
        completion_hint: completionHintPayload,
        bedside_hint: bedsideHint || null,
        bedside_requirement: bedsideRequirement,
        patient_conversation_enabled: patientConversationEnabled,
        patient_conversation_prompt: patientConversationPrompt.trim() || null,
        consultant_response_prompt: consultantResponsePrompt.trim() || null,
        orders_config: ordersConfig,
        is_active: isActive,
        pdf_url: finalPdfUrl,
        school_id: finalSchoolId,
        // Preserve empty array for "all schools" - only set to null if truly undefined
        available_school_ids: normalizedSchoolIds ?? null,
        continues_from: continuesFrom ? Number.parseInt(continuesFrom, 10) : null,
        encounter_type: encounterType,
        hospital_stay_days: hospitalTimeline.stayDays,
        hospital_timeline: hospitalTimeline,
      };

      let timelinePatientId: string | null = room?.patient_id ?? null;
      let timelineRoomId: number | null = room?.id ?? null;

      if (room) {
        const { error } = await supabase
          .from('rooms')
          .update(roomData)
          .eq('id', room.id);
        
        if (error) throw error;

        // Sync patient.room_id when editing an existing room
        // Clear previous patient's room_id if patient changed
        const oldPatientId = room.patient_id;
        const newPatientId = roomData.patient_id ?? oldPatientId;
        if (oldPatientId && oldPatientId !== newPatientId) {
          await supabase.from('patients').update({ room_id: null }).eq('id', oldPatientId);
        }
        if (newPatientId) {
          await supabase.from('patients').update({ room_id: room.id }).eq('id', newPatientId);
        }
      } else {
        const { data: inserted, error } = await supabase
          .from('rooms')
          .insert([roomData])
          .select()
          .single();
        
        if (error) throw error;

        if (patientName.trim()) {
          const [firstName, ...rest] = patientName.trim().split(' ');
          const lastName = rest.join(' ') || 'Patient';
          const mrn = `ROOM-${inserted.room_number}-${Date.now()}`;

          const patientPayload = {
            room_id: inserted.id,
            school_id: inserted.school_id ?? finalSchoolId,
            mrn,
            first_name: firstName || 'Patient',
            last_name: lastName,
            date_of_birth: '1990-01-01',
            gender: 'Other',
            admission_date: new Date().toISOString().slice(0, 10),
            service: null,
            attending_physician: null,
          };

          const { data: patientRecord, error: patientError } = await supabase
            .from('patients')
            .insert([patientPayload])
            .select()
            .single();
          if (patientError || !patientRecord) {
            console.error('Failed to create patient for room', patientError);
            setError('Room saved, but failed to create EMR patient. Please link manually in Room Management.');
          } else {
            timelinePatientId = patientRecord.id;
            timelineRoomId = inserted.id;
            await supabase.from('rooms').update({ patient_id: patientRecord.id }).eq('id', inserted.id);
            try {
              const initialLabs = buildInitialLabResults(
                patientRecord.id,
                patientRecord.school_id ?? finalSchoolId,
              );
              const { error: labError } = await supabase.from('lab_results').insert(initialLabs);
              if (labError) {
                console.error('Failed to seed initial labs', labError);
              }
            } catch (seedError) {
              console.error('Error seeding initial labs', seedError);
            }
          }
        }
      }

      if (timelinePatientId && timelineRoomId && hospitalTimeline.entries.length > 0) {
        const { error } = await supabase.rpc('materialize_hospital_timeline', {
          p_room_id: timelineRoomId,
          p_patient_id: timelinePatientId,
          p_school_id: finalSchoolId,
          p_case_blueprint_id: room?.case_blueprint_id ?? null,
          p_timeline: hospitalTimeline,
          p_nurse_context: mergeHospitalTimelineIntoNurseContext(nurseContext, hospitalTimeline),
          p_generated_at: new Date().toISOString(),
        });
        if (error) throw error;
      }

      onSave();
    } catch (error) {
      console.error('Error saving room:', error);
      setError('Failed to save room. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTreatmentChange = (index: number, value: string) => {
    const newTreatments = [...expectedTreatment];
    newTreatments[index] = value;
    setExpectedTreatment(newTreatments);
  };

  const addTreatment = () => {
    setExpectedTreatment([...expectedTreatment, '']);
  };

  const removeTreatment = (index: number) => {
    setExpectedTreatment(expectedTreatment.filter((_, i) => i !== index));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Information */}
      <div className="space-y-4">
        {hasAdminAccess(profile) && isSuperAdmin(profile) && (
          <div className="space-y-3">
            <div>
              <label htmlFor="school" className="block text-sm font-medium text-gray-700">
                Primary school
              </label>
              <select
                id="school"
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                required
              >
                <option value="" disabled>
                  Select a school
                </option>
                {schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {getSchoolDisplayName(school)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="flex items-center mb-2">
                <input
                  type="checkbox"
                  id="allSchools"
                  checked={allSchoolsSelected}
                  onChange={(e) => {
                    setAllSchoolsSelected(e.target.checked);
                    if (e.target.checked) {
                      setAvailableSchoolIds([]);
                    }
                  }}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="allSchools" className="ml-2 block text-sm font-medium text-gray-700">
                  Available to all schools
                </label>
              </div>
              {!allSchoolsSelected && (
                <>
                  <label htmlFor="availableSchools" className="block text-sm font-medium text-gray-700">
                    Available to specific schools
                  </label>
                  <select
                    id="availableSchools"
                    multiple
                    value={availableSchoolIds.filter((id) => id !== schoolId)}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions)
                        .map((option) => option.value)
                        .filter(Boolean);
                      setAvailableSchoolIds(
                        schoolId ? Array.from(new Set([schoolId, ...selected])) : selected,
                      );
                    }}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  >
                    {(schoolId ? schools.filter((school) => school.id !== schoolId) : schools).map((school) => (
                      <option key={school.id} value={school.id}>
                        {getSchoolDisplayName(school)}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">Primary school is always included.</p>
                </>
              )}
            </div>
          </div>
        )}
        {hasAdminAccess(profile) && !isSuperAdmin(profile) && (
          <div>
            <label className="block text-sm font-medium text-gray-700">School</label>
            <p className="mt-1 text-sm text-gray-500">
              This room belongs to your school assignment and cannot be changed.
            </p>
          </div>
        )}
        <div>
          <label htmlFor="learnerProgram" className="block text-sm font-medium text-gray-700">
            Learner program
          </label>
          <select
            id="learnerProgram"
            value={learnerProgram}
            onChange={(e) => setLearnerProgram(e.target.value as LearnerProgram)}
            disabled={Boolean(room)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm disabled:bg-gray-100"
          >
            {LEARNER_PROGRAMS.map((program) => (
              <option key={program.value} value={program.value}>{program.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            {room ? 'Existing rooms remain in their current track.' : 'Choose the track for this future room; no room is created until you save.'}
          </p>
        </div>

        <div>
          <label htmlFor="specialty" className="block text-sm font-medium text-gray-700">
            Specialties
          </label>
          <select
            id="specialty"
            multiple
            value={specialtyIds}
            onChange={(e) =>
              setSpecialtyIds(Array.from(e.target.selectedOptions).map((option) => option.value).filter(Boolean))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            {specialties.map((specialty) => (
              <option key={specialty.id} value={specialty.id}>
                {specialty.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">
            {schoolId ? 'Select one or more specialties (Ctrl/Cmd+click to select multiple)' : 'Select a school first to load specialties'}
          </p>
        </div>

        <div>
          <label htmlFor="roomNumber" className="block text-sm font-medium text-gray-700">
            Room Number
          </label>
          <input
            type="text"
            id="roomNumber"
            value={roomNumber}
            onChange={(e) => setRoomNumber(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            required
          />
        </div>

        <div>
          <label htmlFor="continuesFrom" className="block text-sm font-medium text-gray-700">
            Continues from (optional)
          </label>
          <select
            id="continuesFrom"
            value={continuesFrom}
            onChange={(e) => setContinuesFrom(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          >
            <option value="">None</option>
            {roomOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                Room {opt.room_number}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">Use this to carry over labs/orders/vitals from a prior room.</p>
        </div>

        <div>
          <label htmlFor="role" className="block text-sm font-medium text-gray-700">
            Role
          </label>
          <textarea
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            required
          />
        </div>

        <div>
          <label htmlFor="objective" className="block text-sm font-medium text-gray-700">
            Objective
          </label>
          <textarea
            id="objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            required
          />
        </div>

        <div>
          <label htmlFor="nurseContext" className="block text-sm font-medium text-gray-700">
            Nurse Context
          </label>
          <textarea
            id="nurseContext"
            value={nurseContext}
            onChange={(e) => setNurseContext(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            required
          />
        </div>

        <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">Conversation Prompts</h3>
          <p className="mt-1 text-xs text-gray-600">
            These are the complete authored instructions for each channel. Blank means that channel is unavailable; no platform clinical default is substituted.
            Prompt text is server-only and is never shown as learner chat content.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="patientConversationPrompt" className="block text-sm font-medium text-gray-700">
              Patient conversation prompt
            </label>
            <textarea
              id="patientConversationPrompt"
              value={patientConversationPrompt}
              onChange={(e) => setPatientConversationPrompt(e.target.value)}
              rows={4}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              placeholder="History, voice/affect, knowledge boundaries, response rules, and what the patient may or may not disclose."
            />
            <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={patientConversationEnabled}
                onChange={(e) => setPatientConversationEnabled(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Enable patient conversation for students
            </label>
            <label htmlFor="patientResponseMode" className="mt-3 block text-xs font-medium text-gray-700">Patient response mode</label>
            <select
              id="patientResponseMode"
              value={patientResponseMode}
              onChange={(e) => setPatientResponseMode(e.target.value as 'responsive' | 'unable')}
              className="mt-1 block w-full rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="responsive">Respond using the authored patient prompt</option>
              <option value="unable">Unable to respond — return “Patient unable to respond.”</option>
            </select>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void saveConversationPrompt('patient')} className="rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">Save patient prompt</button>
              <button type="button" onClick={() => setPromptPreview(promptPreview === 'patient' ? null : 'patient')} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700">{promptPreview === 'patient' ? 'Hide preview' : 'Preview'}</button>
              {patientPromptStatus && <span role="status" className="text-xs text-gray-600">{patientPromptStatus}</span>}
            </div>
            {promptPreview === 'patient' && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border bg-white p-2 text-xs text-gray-700">{patientConversationPrompt.trim() || 'Prompt not configured'}</pre>}
            <p className="mt-1 text-xs text-gray-500">Saved directly to this room and supplied exactly to patient-chat for its assignments.</p>
          </div>
          <div>
            <label htmlFor="consultantResponsePrompt" className="block text-sm font-medium text-gray-700">
              Consultant conversation prompt (room override)
            </label>
            <textarea
              id="consultantResponsePrompt"
              value={consultantResponsePrompt}
              onChange={(e) => setConsultantResponsePrompt(e.target.value)}
              rows={4}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              placeholder="Complete consultant behavior, acknowledgment, recommendations, and any authored urgent exceptions."
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void saveConversationPrompt('consultant')} className="rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">Save consultant prompt</button>
              <button type="button" onClick={() => setPromptPreview(promptPreview === 'consultant' ? null : 'consultant')} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700">{promptPreview === 'consultant' ? 'Hide preview' : 'Preview'}</button>
              {consultantPromptStatus && <span role="status" className="text-xs text-gray-600">{consultantPromptStatus}</span>}
            </div>
            {promptPreview === 'consultant' && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border bg-white p-2 text-xs text-gray-700">{consultantResponsePrompt.trim() || 'Prompt not configured'}</pre>}
            <p className="mt-1 text-xs text-gray-500">Saved directly to the room and used by the pinned consultant-chat runtime; authored instructions are never shown to learners.</p>
            {!consultantResponsePrompt.trim() && (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                Prompt not configured. Consultant Portal is unavailable until an administrator authors this room prompt; no shared default is substituted.
              </p>
            )}
          </div>
          </div>

        <div className={`rounded-lg border p-4 ${consultantPromptReady ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <h3 className="text-sm font-semibold text-gray-900">Consultant readiness preview</h3>
          <p className="mt-1 text-xs text-gray-700">
            {consultantPromptReady
              ? 'Ready: this room override will be used by the consultant model. A failed platform consultation must preserve the learner draft and is not a learner scoring event.'
              : 'Not ready: no authored consultant prompt is saved. Consultant Portal will refuse the request and preserve the learner draft.'}
          </p>
          <p className="mt-2 text-xs text-gray-600">Preview input: synthetic summary → specialty selection → concise question. The saved prompt is not returned to learners.</p>
        </div>

        <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
          <h3 className="text-sm font-semibold text-gray-900">Pre-page hospital timeline</h3>
          <p className="mt-1 text-xs text-gray-600">Chart history is visible before the overnight encounter but is never treated as learner action evidence.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">Encounter type
              <select value={encounterType} onChange={(e) => setEncounterType(e.target.value as EncounterType)} className="mt-1 block w-full rounded-md border-gray-300 text-sm">
                <option value="inpatient">Inpatient</option><option value="ed">ED visit (single encounter)</option><option value="ld">L&amp;D / postpartum</option>
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">Hospital stay days (1–3)
              <input type="number" min="1" max="3" value={hospitalStayDays} onChange={(e) => setHospitalStayDays(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 text-sm" />
            </label>
          </div>
          <div className="mt-3"><HospitalTimelineEditor value={hospitalTimelineText} encounterType={encounterType} onChange={setHospitalTimelineText} /></div>
          {timelineWarning && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{timelineWarning}</p>}
          {(() => { try { const timeline = { ...parseHospitalTimeline(JSON.parse(hospitalTimelineText)), encounterType }; const errors = validateHospitalTimeline(timeline); return <div className={`mt-2 text-xs ${errors.length ? 'text-rose-700' : 'text-emerald-700'}`}>{errors.length ? <p>{errors.join(' ')}</p> : <p>Verified trend preview: {timelineTrend(timeline).join(' · ') || 'No lab trend entries.'}</p>}</div>; } catch { return <p className="mt-2 text-xs text-rose-700">Timeline JSON is invalid.</p>; } })()}
        </div>

        <div>
          <label htmlFor="style" className="block text-sm font-medium text-gray-700">
            Style
          </label>
          <textarea
            id="style"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            required
          />
        </div>

        <div>
          <label htmlFor="patientName" className="block text-sm font-medium text-gray-700">
            Create new patient (optional)
          </label>
          <input
            type="text"
            id="patientName"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="e.g., Alex Rivera"
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            Leave blank to create the room without an EMR patient.
          </p>
        </div>

        <div>
          <label htmlFor="emrContext" className="block text-sm font-medium text-gray-700">
            EHR Context
          </label>
          <textarea
            id="emrContext"
            value={emrContext}
            onChange={(e) => setEmrContext(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="Ongoing EMR rules or responses (e.g., “if WBC ordered, increase each run”)."
          />
          {room && (
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                data-testid="save-emr-context"
                onClick={() => void handleContextOnlySave()}
                disabled={isLoading}
                className="rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save EMR context
              </button>
              <span className="text-xs text-gray-500">Saves only this field; required full-room fields and timeline validation are not run.</span>
            </div>
          )}
        </div>
        {isObgynRoom && (
          <div>
            <label htmlFor="deliveryNote" className="block text-sm font-medium text-gray-700">
              Delivery Note (OBGYN continuation)
            </label>
            <textarea
              id="deliveryNote"
              value={deliveryNote}
              onChange={(e) => setDeliveryNote(e.target.value)}
              rows={3}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              placeholder="Add prior delivery details for continuation cases."
            />
          </div>
        )}

        <div>
          <label htmlFor="caseGoals" className="block text-sm font-medium text-gray-700">
            Goals of Case
          </label>
          <textarea
            id="caseGoals"
            value={caseGoals}
            onChange={(e) => setCaseGoals(e.target.value)}
            rows={2}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            placeholder="Key goals learners should hit"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="progressNote" className="block text-sm font-medium text-gray-700">
              Progress Note
            </label>
            <textarea
              id="progressNote"
              value={progressNote}
              onChange={(e) => setProgressNote(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              placeholder="Preloaded progress note content"
            />
          </div>
          <div className="space-y-2">
            <div>
              <label htmlFor="assessmentHint" className="block text-sm font-medium text-gray-700">
                Assessment Hint
              </label>
              <textarea
                id="assessmentHint"
                value={assessmentHint}
                onChange={(e) => setAssessmentHint(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="Guidance shown when completing assessment (renamed from attending hint)."
              />
            </div>
            <div>
              <label htmlFor="diagnosisDifferentiatorHint" className="block text-sm font-medium text-gray-700">
                Diagnosis Differentiator Hint
              </label>
              <textarea
                id="diagnosisDifferentiatorHint"
                value={diagnosisDifferentiatorHint}
                onChange={(e) => setDiagnosisDifferentiatorHint(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="Guidance for distinguishing top diagnoses."
              />
            </div>
            <div>
              <label htmlFor="planHint" className="block text-sm font-medium text-gray-700">
                Plan Hint
              </label>
              <textarea
                id="planHint"
                value={planHint}
                onChange={(e) => setPlanHint(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="Guidance for final management plan."
              />
            </div>
            <div>
              <label htmlFor="bedsideHint" className="block text-sm font-medium text-gray-700">
                Go To Bedside Hint
              </label>
              <input
                type="text"
                id="bedsideHint"
                value={bedsideHint}
                onChange={(e) => setBedsideHint(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="Guidance shown when going bedside"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Bedside Verdict
              </label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {bedsideRequirementOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setBedsideRequirement(option.value)}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                      bedsideRequirement === option.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Shown in feedback so learners know whether bedside evaluation was warranted.
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Orders & Labs configuration */}
      <div className="space-y-4 border-t border-gray-200 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">Orders & Labs (EMR)</h3>
            <p className="text-sm text-gray-600">
              All labs are available. Instant labs will auto-generate results; pending labs will stay pending.
            </p>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Orders/Labs notes (optional)</label>
          <textarea
            rows={3}
            value={ordersConfig.notes || ''}
            onChange={(e) => setOrdersConfig((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="Any overarching instructions for lab ordering in this room"
            className="mt-1 block w-full rounded-md border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          />
        </div>
      </div>

      {/* Advanced settings remain in state and roomData for backwards-compatible persistence,
          but are intentionally not exposed in the editor UI for now. */}
      {advancedSettingsVisible && (
          <div className="space-y-4 border-t border-gray-200 pt-6">
            <div>
              <label htmlFor="difficulty" className="block text-sm font-medium text-gray-700">
                Difficulty Level
              </label>
              <select
                id="difficulty"
                value={difficultyLevel || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setDifficultyLevel(value === '' ? null : value as 'beginner' | 'intermediate' | 'advanced');
                }}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              >
                <option value="">No difficulty set</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>

            <div>
              <label htmlFor="expectedDiagnosis" className="block text-sm font-medium text-gray-700">
                Expected Diagnosis
              </label>
              <textarea
                id="expectedDiagnosis"
                value={expectedDiagnosis}
                onChange={(e) => setExpectedDiagnosis(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                placeholder="Enter the expected diagnosis"
              />
            </div>

            <div>
              <label htmlFor="evaluationLeniencyMultiplier" className="block text-sm font-medium text-gray-700">
                Evaluation Leniency Multiplier
              </label>
              <input
                id="evaluationLeniencyMultiplier"
                type="number"
                min={0.75}
                max={1.5}
                step={0.05}
                value={evaluationLeniencyMultiplier}
                onChange={(e) => setEvaluationLeniencyMultiplier(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                `1.00` is neutral. Values above `1.00` make grading more lenient on borderline cases; values below `1.00` make it stricter.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Expected Treatment Steps
              </label>
              <div className="space-y-2">
                {expectedTreatment.map((treatment, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={treatment}
                      onChange={(e) => handleTreatmentChange(index, e.target.value)}
                      className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                      placeholder={`Treatment step ${index + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeTreatment(index)}
                      className="px-2 py-1 text-sm text-red-600 hover:text-red-800"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addTreatment}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  + Add treatment step
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="isActive" className="ml-2 block text-sm text-gray-700">
                  Room is active
                </label>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Inactive rooms won't be available for assignments
              </p>
            </div>
          </div>
      )}

      {error && (
        <div className="text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Room'
          )}
        </button>
      </div>
    </form>
  );
} 
