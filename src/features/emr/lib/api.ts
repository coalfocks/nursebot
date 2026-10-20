import { supabase } from '../../../lib/supabase';
import { resolveAssignmentRoom } from '../../../lib/assignmentBaseline';
import type { Database } from '../../../lib/database.types';
import type {
  Patient,
  ClinicalNote,
  LabResult,
  VitalSigns,
  MedicalOrder,
  MarAdministrationEvent,
  ImagingStudy,
  ImagingImage,
  RoomOrdersConfig,
  CustomOverviewSection,
  IntakeOutput,
  type LabWriteResult,
  type VersionedMutationResult,
} from './types';

import { resolveOverrideScope, scopeMatchesContext, type RoomLineage } from './scope';
import { normalizeLabResult } from './labIntegrity';
type ClinicalNoteRow = Database['public']['Tables']['clinical_notes']['Row'];
type ImagingStudyRow = Database['public']['Tables']['imaging_studies']['Row'];
type LabResultRow = Database['public']['Tables']['lab_results']['Row'];
type MedicalOrderRow = Database['public']['Tables']['medical_orders']['Row'];

const deriveScope = resolveOverrideScope;

const imagingOrderMatchesStudy = (orderName: string, studyName: string) => {
  const order = orderName.trim().toLowerCase();
  const study = studyName.trim().toLowerCase();
  if (!order || !study) return false;
  if (order === study || order.includes(study) || study.includes(order)) return true;

  const modality = ['mri', 'ct', 'ultrasound', 'echocardiogram', 'echo', 'x-ray', 'xray'].find(
    (term) => order.includes(term) && study.includes(term),
  );
  return Boolean(modality);
};

const getRoomLineage = async (roomId?: number | null): Promise<RoomLineage | null> => {
  if (!roomId) return null;
  const visited = new Set<number>();
  const lineage: number[] = [];
  let current: number | null | undefined = roomId;

  while (current && !visited.has(current)) {
    visited.add(current);
    lineage.push(current);
    const { data, error } = await supabase
      .from('rooms')
      .select('continues_from')
      .eq('id', current)
      .maybeSingle();
    if (error) {
      console.error('Error fetching room continuity', error);
      break;
    }
    current = data?.continues_from ?? null;
  }

  return lineage;
};

const mapPatient = (
  row: Database['public']['Tables']['patients']['Row'],
  roomIdOverride?: number | null,
): Patient => ({
  id: row.id,
  schoolId: row.school_id,
  roomId: roomIdOverride ?? row.room_id,
  mrn: row.mrn,
  firstName: row.first_name,
  lastName: row.last_name,
  dateOfBirth: row.date_of_birth,
  gender: (row.gender as Patient['gender']) ?? 'Other',
  room: roomIdOverride ? String(roomIdOverride) : row.room_id ? String(row.room_id) : row.service ?? undefined,
  service: row.service ?? undefined,
  admissionDate: row.admission_date ?? undefined,
  attendingPhysician: row.attending_physician ?? undefined,
  allergies: row.allergies ?? [],
  codeStatus: (row.code_status as Patient['codeStatus']) ?? undefined,
  deletedAt: row.deleted_at,
  customOverviewSections:
    (row.custom_overview_sections as { sections?: CustomOverviewSection[] } | null | undefined)?.sections ??
    undefined,
  intakeOutput: (row.intake_output as IntakeOutput | null | undefined) ?? undefined,
  weightKg: row.weight_kg ?? undefined,
});

const mapClinicalNote = (row: ClinicalNoteRow, fallbackPatientId: string): ClinicalNote => {
  const scope = deriveScope(row.override_scope, row.assignment_id, row.room_id);
  return {
    id: row.id,
    patientId: row.patient_id ?? fallbackPatientId,
    assignmentId: row.assignment_id ?? undefined,
    roomId: row.room_id ?? undefined,
    overrideScope: scope,
    type: row.note_type as ClinicalNote['type'],
    title: row.title,
    content: row.content,
    author: row.author ?? 'Unknown',
    timestamp: row.timestamp,
    signed: row.signed ?? false,
    recordVersion: row.record_version,
    timelineEntryId: row.timeline_entry_id,
    relativeOffsetHours: row.relative_offset_hours,
  };
};

const mapMedicalOrder = (row: MedicalOrderRow, fallbackPatientId = ''): MedicalOrder => {
  const scope = deriveScope(row.override_scope, row.assignment_id, row.room_id);
  return {
    id: row.id,
    patientId: row.patient_id ?? fallbackPatientId,
    assignmentId: row.assignment_id ?? undefined,
    roomId: row.room_id ?? undefined,
    overrideScope: scope,
    category: row.category as MedicalOrder['category'],
    orderName: row.order_name,
    frequency: row.frequency ?? undefined,
    route: row.route ?? undefined,
    dose: row.dose ?? undefined,
    priority: (row.priority as MedicalOrder['priority']) ?? 'Routine',
    status: (row.status as MedicalOrder['status']) ?? 'Active',
    orderedBy: row.ordered_by ?? 'Unknown',
    orderTime: row.order_time ?? new Date().toISOString(),
    scheduledTime: row.scheduled_time ?? undefined,
    instructions: row.instructions ?? undefined,
    resultFailureReason: row.result_failure_reason ?? null,
    resultAttemptKey: row.result_attempt_key ?? null,
    resultGenerationStatus: row.result_generation_status ?? 'not_started',
    deletedAt: row.deleted_at,
    recordVersion: row.record_version,
  };
};

const mapMarEvent = (row: Database['public']['Tables']['mar_administration_events']['Row']): MarAdministrationEvent => ({
  id: row.id,
  patientId: row.patient_id,
  roomId: row.room_id,
  assignmentId: row.assignment_id,
  orderId: row.order_id,
  caseVersion: row.case_version,
  occurrenceKey: row.occurrence_key,
  relativeOffsetHours: row.relative_offset_hours,
  administeredAt: row.administered_at,
  medicationName: row.medication_name,
  orderedDose: row.ordered_dose,
  administeredDose: row.administered_dose,
  unit: row.unit,
  route: row.route,
  frequency: row.frequency,
  category: row.category as MarAdministrationEvent['category'],
  status: row.status as MarAdministrationEvent['status'],
  simulatedClinician: row.simulated_clinician,
  reason: row.reason,
  prnIndication: row.prn_indication,
  response: row.response,
  infusionDetails: (row.infusion_details as Record<string, unknown> | null) ?? null,
  source: row.source as MarAdministrationEvent['source'],
  actorLabel: row.actor_label,
  recordVersion: row.record_version,
});

/** Supabase errors may be Error instances or PostgREST-shaped plain objects. */
export const marRpcErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; code?: unknown; details?: unknown };
    if (typeof value.message === 'string' && value.message.trim()) return value.message;
    if (typeof value.code === 'string' && value.code.trim()) return value.code;
    if (typeof value.details === 'string' && value.details.trim()) return value.details;
  }
  return 'Unable to complete the MAR request.';
};

const mapLabResult = (row: LabResultRow, fallbackPatientId: string): LabResult => {
  const valueType = (row.value_type as LabResult['valueType']) ?? (row.value !== null ? 'numeric' : 'coded');
  const mapped: LabResult = {
    id: row.id,
    recordVersion: row.record_version,
    patientId: row.patient_id ?? fallbackPatientId,
    assignmentId: row.assignment_id,
    roomId: row.room_id ?? undefined,
    overrideScope: deriveScope(row.override_scope, row.assignment_id, row.room_id),
    testName: row.test_name,
    value: valueType === 'numeric' ? row.value ?? '' : row.text_value ?? row.narrative ?? '',
    valueType,
    narrative: row.narrative,
    interpretation: row.interpretation,
    abnormalFlag: row.abnormal_flag,
    specimen: row.specimen,
    unit: row.unit ?? '',
    referenceRange: row.reference_range ?? '',
    status: (row.status as LabResult['status']) ?? 'Pending',
    lifecycleStatus: (row.lifecycle_status as LabResult['lifecycleStatus']) ?? (row.status === 'Pending' ? 'pending' : 'resulted'),
    collectionTime: row.collection_time ?? new Date().toISOString(),
    resultTime: row.result_time ?? undefined,
    orderedBy: row.ordered_by ?? 'Unknown',
    createdAt: row.created_at ?? undefined,
    deletedAt: row.deleted_at,
    timelineEntryId: row.timeline_entry_id,
    relativeOffsetHours: row.relative_offset_hours,
  };
  return normalizeLabResult(mapped);
};

const serializeLabValue = (lab: LabResult) => {
  const explicitType = lab.valueType;
  const numericValue = typeof lab.value === 'number' ? lab.value : Number(lab.value);
  const isNumeric = explicitType === 'numeric' || (!explicitType && lab.value !== '' && Number.isFinite(numericValue));
  return {
    value: isNumeric && Number.isFinite(numericValue) ? numericValue : null,
    value_type: explicitType ?? (isNumeric ? 'numeric' : 'coded'),
    text_value: isNumeric ? null : String(lab.value ?? ''),
    narrative: lab.narrative ?? null,
    interpretation: lab.interpretation ?? null,
    abnormal_flag: lab.abnormalFlag ?? null,
    specimen: lab.specimen ?? null,
    lifecycle_status: lab.lifecycleStatus ?? (lab.status === 'Pending' ? 'pending' : 'resulted'),
  };
};

const mapImagingStudy = (row: ImagingStudyRow, fallbackPatientId: string): ImagingStudy => {
  const scope = deriveScope(row.override_scope, row.assignment_id, row.room_id);
  const images = Array.isArray(row.images) ? (row.images as ImagingImage[]) : [];
  return {
    id: row.id,
    patientId: row.patient_id ?? fallbackPatientId,
    assignmentId: row.assignment_id ?? undefined,
    roomId: row.room_id ?? undefined,
    overrideScope: scope,
    orderName: row.order_name ?? undefined,
    studyType: row.study_type,
    contrast: (row.contrast as ImagingStudy['contrast']) ?? undefined,
    priority: (row.priority as ImagingStudy['priority']) ?? undefined,
    status: row.status ?? undefined,
    orderedBy: row.ordered_by ?? undefined,
    orderTime: row.order_time,
    report: row.report ?? undefined,
    bodySite: row.body_site ?? undefined,
    laterality: row.laterality ?? undefined,
    indication: row.indication ?? undefined,
    findings: row.findings ?? undefined,
    impression: row.impression ?? undefined,
    encounterTime: row.encounter_time ?? undefined,
    recordVersion: row.record_version,
    reportGeneratedAt: row.report_generated_at ?? undefined,
    images,
    deletedAt: row.deleted_at,
    timelineEntryId: row.timeline_entry_id,
    relativeOffsetHours: row.relative_offset_hours,
  };
};

export const emrApi = {
  async getRoomContext(roomId: number, assignmentId?: string | null) {
    const { data: room, error } = await supabase
      .from('rooms')
      .select('id, room_number, context, nurse_context, emr_context, expected_diagnosis, expected_treatment, case_goals, difficulty_level, objective, progress_note, completion_hint, hospital_stay_days')
      .eq('id', roomId)
      .maybeSingle();

    if (error || !room) {
      if (error) console.error('Failed to load room context', error);
      return { data: null, error };
    }

    if (!assignmentId) return { data: room, error: null };

    const { data: assignment, error: assignmentError } = await supabase
      .from('student_room_assignments')
      .select('scenario_baseline')
      .eq('id', assignmentId)
      .maybeSingle();

    if (assignmentError) {
      console.error('Failed to load assignment scenario baseline', assignmentError);
      return { data: room, error: null };
    }

    return {
      data: resolveAssignmentRoom(room, assignment?.scenario_baseline),
      error: null,
    };
  },
  async getPatient(patientId: string): Promise<Patient | null> {
    const { data, error } = await supabase
      .from('patients')
      .select('*, room:room_id(id, room_number)')
      .eq('id', patientId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) {
      if (error) {
        console.error('Error fetching patient', error);
      }
      return null;
    }

    const patient = mapPatient(data as Database['public']['Tables']['patients']['Row']);
    const roomData = (data as { room?: { room_number?: string | null } | null }).room;
    if (roomData?.room_number) {
      patient.room = roomData.room_number;
    }
    return patient;
  },

  async getPatientByRoomId(roomId: number): Promise<Patient | null> {
    const { data, error } = await supabase
      .from('rooms')
      .select('id, room_number, patient_id, patient:patient_id(*)')
      .eq('id', roomId)
      .maybeSingle();

    if (data?.patient) {
      const patient = mapPatient(data.patient as Database['public']['Tables']['patients']['Row'], roomId);
      if (data.room_number) {
        patient.room = data.room_number;
      }
      return patient;
    }

    const { data: legacyData, error: legacyError } = await supabase
      .from('patients')
      .select('*')
      .eq('room_id', roomId)
      .is('deleted_at', null)
      .maybeSingle();

    if ((error && !legacyData) || legacyError) {
      console.error('Error fetching patient by room', error || legacyError);
    }

    if (legacyData) {
      return mapPatient(legacyData, roomId);
    }

    return null;
  },

  async listPatients(): Promise<Patient[]> {
    const { data, error } = await supabase
      .from('patients')
      .select('*, room:room_id(id, room_number)')
      .is('deleted_at', null)
      .order('last_name');

    if (error) {
      console.error('Error fetching patients', error);
      return [];
    }

    return (data ?? []).map((row) => {
      const patient = mapPatient(row);
      const roomData = row.room as { id: number; room_number: string } | null;
      if (roomData?.room_number) {
        patient.room = roomData.room_number;
      }
      return patient;
    });
  },

  async listPatientsForStudent(studentId: string, sandboxOnly = false): Promise<Patient[]> {
    let query = supabase
      .from('student_room_assignments')
      .select(
        `
        id,
        status,
        room:room_id (
          id,
          room_number,
          patient:patient_id (*)
        )
      `,
      )
      .eq('student_id', studentId)
      .in('status', ['assigned', 'in_progress', 'bedside', 'completed']);
    if (sandboxOnly) query = query.eq('is_sandbox', true);
    const { data, error } = await query;

    if (error) {
      console.error('Error fetching student patients', error);
      return [];
    }

    const patients = (data ?? [])
      .map((row) => {
        const patientRow = row.room?.patient as Database['public']['Tables']['patients']['Row'] | null;
        if (!patientRow) return null;
        const roomId = row.room?.id ?? patientRow.room_id ?? null;
        const patient = mapPatient(patientRow, roomId);
        return {
          ...patient,
          room: row.room?.room_number ?? patient.room,
        };
      })
      .filter(Boolean) as Patient[];

    const seen = new Set<string>();
    return patients.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  },

  async listClinicalNotes(
    patientId: string,
    assignmentId?: string,
    roomId?: number | null,
    onError?: (event: { source: 'clinical_notes' | 'assignment' | 'room'; message: string }) => void,
  ): Promise<ClinicalNote[]> {
    const targetRooms = await getRoomLineage(roomId);
    const [{ data, error }, assignmentResult] = await Promise.all([
      supabase.from('clinical_notes').select('*').eq('patient_id', patientId).is('deleted_at', null).order('timestamp', { ascending: false }),
      assignmentId
        ? supabase.from('student_room_assignments').select('id, room_id, student_progress_note, completed_at, updated_at').eq('id', assignmentId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (error) {
      console.error('Error fetching clinical notes', error);
      onError?.({ source: 'clinical_notes', message: 'Unable to load saved clinical notes. Refresh the chart and try again.' });
    }

    if (assignmentResult.error) {
      console.error('Error fetching assignment completion note', assignmentResult.error);
      onError?.({ source: 'assignment', message: 'Unable to load the completed assignment note. Refresh the chart and try again.' });
    }

    let assignmentMatchesContext = false;
    if (assignmentId && assignmentResult.data && !assignmentResult.error) {
      const roomResult = await supabase
        .from('rooms')
        .select('id, patient_id')
        .eq('id', assignmentResult.data.room_id)
        .maybeSingle();
      if (roomResult.error) {
        console.error('Error verifying assignment note context', roomResult.error);
        onError?.({ source: 'room', message: 'Unable to verify the assignment note belongs to this patient. Refresh the chart and try again.' });
      } else {
        assignmentMatchesContext = (!roomId || roomResult.data?.id === roomId) && roomResult.data?.patient_id === patientId;
      }
    }

    const notes = (data ?? [])
      .map((row) => mapClinicalNote(row, patientId))
      .filter(
        (note) =>
          !(
            note.assignmentId &&
            note.type === 'Progress' &&
            /^progress note$/i.test(note.title.trim()) &&
            /student/i.test(note.author)
          ),
      )
      .filter((note) =>
        scopeMatchesContext(
          note.overrideScope ?? 'baseline',
          note.roomId ?? null,
          targetRooms,
          note.assignmentId ?? null,
          assignmentId,
        ),
      );
    const progressNote = assignmentResult.data?.student_progress_note?.trim();
    if (assignmentId && assignmentMatchesContext && progressNote) {
      const projectedId = `progress-note-${assignmentId}`;
      const projectedNote: ClinicalNote = {
        id: projectedId,
        patientId,
        assignmentId,
        roomId: assignmentResult.data.room_id ?? roomId ?? null,
        overrideScope: 'assignment',
        type: 'Progress',
        title: 'Progress Note',
        content: progressNote,
        author: 'Simulation Physician',
        timestamp: assignmentResult.data.completed_at ?? undefined,
        signed: true,
      };
      return [projectedNote, ...notes.filter((note) => {
        const isLegacyMirror = note.assignmentId === assignmentId
          && note.type === 'Progress'
          && /^progress note$/i.test(note.title.trim())
          && note.content.trim() === progressNote;
        return note.id !== projectedId && !isLegacyMirror;
      })];
    }
    return notes;
  },

  async addClinicalNote(note: ClinicalNote): Promise<ClinicalNote | null> {
    const overrideScope = deriveScope(note.overrideScope, note.assignmentId, note.roomId);
    const payload = {
      patient_id: note.patientId,
      assignment_id: note.assignmentId ?? null,
      room_id: note.roomId ?? null,
      override_scope: overrideScope,
      note_type: note.type,
      title: note.title,
      content: note.content,
      author: note.author,
      timestamp: note.timestamp,
      signed: note.signed,
    };
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
    const { data, error } = await supabase.from('clinical_notes').insert(cleanPayload).select('*').maybeSingle();

    if (error) {
      console.error('Error inserting clinical note', error);
      return null;
    }
    return data ? mapClinicalNote(data, note.patientId) : null;
  },

  async updateClinicalNote(
    noteId: string,
    updates: Partial<Pick<ClinicalNote, 'title' | 'content' | 'type' | 'signed'>>,
    expectedVersion?: number,
  ): Promise<VersionedMutationResult<ClinicalNote>> {
    const payload = {
      title: updates.title,
      content: updates.content,
      note_type: updates.type,
      signed: updates.signed,
    };
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
    let query = supabase
      .from('clinical_notes')
      .update(cleanPayload)
      .eq('id', noteId);
    if (expectedVersion !== undefined) query = query.eq('record_version', expectedVersion);
    const { data, error } = await query.select('*').maybeSingle();

    if (error) {
      console.error('Error updating clinical note', error);
      return null;
    }
    if (!data) {
      if (expectedVersion === undefined) return null;
      const { data: current, error: currentError } = await supabase
        .from('clinical_notes')
        .select('*')
        .eq('id', noteId)
        .maybeSingle();
      if (currentError || !current) return null;
      return { conflict: true, current: mapClinicalNote(current, current.patient_id ?? ''), expectedVersion };
    }

    return mapClinicalNote(data, data.patient_id ?? '');
  },

  async deleteClinicalNote(noteId: string, patientId?: string): Promise<void> {
    if (!noteId) {
      console.error('Missing clinical note id for delete.');
      return;
    }
    let query = supabase
      .from('clinical_notes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', noteId);
    if (patientId) {
      query = query.eq('patient_id', patientId);
    }
    const { error } = await query;

    if (error) {
      console.error('Error deleting clinical note', error);
    }
  },

  async listLabResults(
    patientId: string,
    assignmentId?: string,
    roomId?: number | null,
    onError?: (message: string) => void,
  ): Promise<LabResult[]> {
    const targetRooms = await getRoomLineage(roomId);
    const queries = [
      supabase
        .from('lab_results')
        .select('*')
        .eq('patient_id', patientId)
        .is('assignment_id', null)
        .is('room_id', null)
        .is('deleted_at', null),
    ];

    if (targetRooms?.length) {
      queries.push(
        supabase
          .from('lab_results')
          .select('*')
          .eq('patient_id', patientId)
          .in('room_id', targetRooms)
          .is('assignment_id', null)
          .is('deleted_at', null),
      );
    }

    if (assignmentId) {
      queries.push(
        supabase
          .from('lab_results')
          .select('*')
          .eq('patient_id', patientId)
          .eq('assignment_id', assignmentId)
          .is('deleted_at', null),
      );
    }

    const results = await Promise.all(queries);
    const errors = results.map(({ error }) => error).filter(Boolean);
    if (errors.length) {
      errors.forEach((error) => console.error('Error fetching labs', error));
      onError?.('Unable to load saved lab results. Refresh the chart and try again.');
    }

    return results
      .flatMap(({ data }) => data ?? [])
      .map((row) => mapLabResult(row, patientId))
      .filter((lab) =>
        scopeMatchesContext(
          lab.overrideScope ?? 'baseline',
          lab.roomId ?? null,
          targetRooms,
          lab.assignmentId ?? null,
          assignmentId,
        ),
      )
      .sort((a, b) => {
        const aTime = new Date(a.collectionTime ?? a.resultTime ?? 0).getTime();
        const bTime = new Date(b.collectionTime ?? b.resultTime ?? 0).getTime();
        return bTime - aTime;
      });
  },

  async addLabResults(labs: LabResult[], roomId?: number | null): Promise<LabWriteResult> {
    if (!labs.length) return { ok: true };
    labs = labs.map((lab) => normalizeLabResult(lab));
    
    // Check if all labs are baseline scope (no assignment, no room)
    const allBaseline = labs.every((lab) => {
      const scope = deriveScope(lab.overrideScope, lab.assignmentId, lab.roomId ?? roomId ?? null);
      return scope === 'baseline';
    });

    if (allBaseline) {
      const patientId = labs[0].patientId;
      const { data: existingLabs, error: existingError } = await supabase
        .from('lab_results')
        .select('id, test_name, collection_time, result_time')
        .eq('patient_id', patientId)
        .eq('override_scope', 'baseline')
        .is('assignment_id', null)
        .is('room_id', null)
        .is('deleted_at', null);

      if (existingError) {
        console.error('Error fetching baseline labs', existingError);
        return { ok: false, error: existingError.message };
      }

      // Always use a single consolidated timestamp for all baseline labs
      // If any existing baseline labs exist, use their timestamp; otherwise use the baseline epoch
      const baselineTimestamp =
        existingLabs && existingLabs.length > 0
          ? existingLabs[0].collection_time ?? existingLabs[0].result_time ?? '2000-01-01T00:00:00.000Z'
          : '2000-01-01T00:00:00.000Z';

      // Normalize all existing baseline labs to the consolidated timestamp
      const labsNeedingTimestampNormalization = (existingLabs ?? [])
        .filter((lab) => {
          const labTime = lab.collection_time ?? lab.result_time;
          return labTime && labTime !== baselineTimestamp;
        })
        .map((lab) => ({
          id: lab.id,
          payload: {
            collection_time: baselineTimestamp,
            result_time: baselineTimestamp,
          },
        }));

      if (labsNeedingTimestampNormalization.length > 0) {
        const normalizeResults = await Promise.all(
          labsNeedingTimestampNormalization.map((update) =>
            supabase
              .from('lab_results')
              .update(update.payload)
              .eq('id', update.id),
          ),
        );
        const normalizationError = normalizeResults.find(({ error }) => error)?.error;
        if (normalizationError) {
          console.error('Error normalizing baseline lab timestamp', normalizationError);
          return { ok: false, error: normalizationError.message };
        }
      }

      const existingByTest = new Map(
        (existingLabs ?? []).map((lab) => [lab.test_name, lab]),
      );

      const updates = labs
        .map((lab) => {
          const existing = existingByTest.get(lab.testName);
          if (!existing) return null;
          return {
            id: existing.id,
            payload: {
              patient_id: lab.patientId,
              assignment_id: null,
              room_id: null,
              override_scope: 'baseline' as const,
              test_name: lab.testName,
              ...serializeLabValue(lab),
              unit: lab.unit,
              reference_range: lab.referenceRange,
              status: lab.status,
              collection_time: baselineTimestamp,
              result_time: baselineTimestamp,
              ordered_by: lab.orderedBy,
            },
          };
        })
        .filter((entry): entry is { id: string; payload: Record<string, unknown> } => Boolean(entry));

      const inserts = labs
        .filter((lab) => !existingByTest.has(lab.testName))
        .map((lab) => ({
          patient_id: lab.patientId,
          assignment_id: null,
          room_id: null,
          override_scope: 'baseline' as const,
          test_name: lab.testName,
          ...serializeLabValue(lab),
          unit: lab.unit,
          reference_range: lab.referenceRange,
          status: lab.status,
          collection_time: baselineTimestamp,
          result_time: baselineTimestamp,
          ordered_by: lab.orderedBy,
        }));

      if (updates.length) {
        const updateResults = await Promise.all(
          updates.map((update) =>
            supabase
              .from('lab_results')
              .update(update.payload)
              .eq('id', update.id),
          ),
        );
        const updateError = updateResults.find(({ error }) => error)?.error;
        if (updateError) {
          console.error('Error updating baseline lab', updateError);
          return { ok: false, error: updateError.message };
        }
      }

      if (inserts.length) {
        const { error: insertError } = await supabase.from('lab_results').insert(inserts);
        if (insertError) {
          console.error('Error inserting baseline labs', insertError);
          return { ok: false, error: insertError.message };
        }
      }
      return { ok: true };
    }

    // Insert new entries for each non-baseline run to preserve multiple runs.
    const payload = labs.map((lab) => ({
      patient_id: lab.patientId,
      assignment_id: lab.assignmentId ?? null,
      room_id: lab.roomId ?? roomId ?? null,
      override_scope: deriveScope(lab.overrideScope, lab.assignmentId, lab.roomId ?? roomId ?? null),
      test_name: lab.testName,
      ...serializeLabValue(lab),
      unit: lab.unit,
      reference_range: lab.referenceRange,
      status: lab.status,
      collection_time: lab.collectionTime,
      result_time: lab.resultTime,
      ordered_by: lab.orderedBy,
    }));
    const { error } = await supabase.from('lab_results').insert(payload);
    if (error) {
      console.error('Error inserting labs', error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },

  async updateLabResult(
    labId: string,
    updates: Partial<Pick<LabResult, 'testName' | 'value' | 'valueType' | 'unit' | 'referenceRange' | 'status' | 'collectionTime' | 'resultTime' | 'interpretation' | 'abnormalFlag' | 'specimen' | 'lifecycleStatus'>>,
    expectedVersion?: number,
  ): Promise<VersionedMutationResult<LabResult>> {
    const normalizedValue = updates.value === undefined
      ? null
      : normalizeLabResult({
          id: labId,
          patientId: '',
          testName: updates.testName ?? '',
          value: updates.value,
          valueType: updates.valueType,
          unit: updates.unit ?? '',
          referenceRange: updates.referenceRange ?? '',
          status: updates.status ?? 'Unknown',
          collectionTime: updates.collectionTime ?? new Date().toISOString(),
          orderedBy: '',
          lifecycleStatus: updates.lifecycleStatus,
        });
    const valuePatch = normalizedValue === null
      ? {}
      : serializeLabValue(normalizedValue);
    let query = supabase
      .from('lab_results')
      .update({
        test_name: updates.testName,
        ...valuePatch,
        unit: updates.unit,
        reference_range: updates.referenceRange,
        status: normalizedValue?.status,
        collection_time: updates.collectionTime,
        result_time: updates.resultTime,
        interpretation: updates.interpretation,
        abnormal_flag: normalizedValue ? normalizedValue.abnormalFlag : updates.abnormalFlag,
        specimen: updates.specimen,
        lifecycle_status: updates.lifecycleStatus,
      })
      .eq('id', labId);
    if (expectedVersion !== undefined) query = query.eq('record_version', expectedVersion);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      console.error('Error updating lab result', error);
      return null;
    }
    if (!data) {
      if (expectedVersion === undefined) return null;
      const { data: current, error: currentError } = await supabase
        .from('lab_results')
        .select('*')
        .eq('id', labId)
        .maybeSingle();
      if (currentError || !current) return null;
      return { conflict: true, current: mapLabResult(current, current.patient_id ?? ''), expectedVersion };
    }
    return mapLabResult(data, data.patient_id ?? '');
  },

  async listVitals(patientId: string, assignmentId?: string, roomId?: number | null): Promise<VitalSigns[]> {
    const targetRooms = await getRoomLineage(roomId);
    const { data, error } = await supabase
      .from('vital_signs')
      .select('*')
      .eq('patient_id', patientId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('Error fetching vitals', error);
      return [];
    }

    return (data ?? [])
      .map((row) => {
        const scope = deriveScope(row.override_scope, row.assignment_id, row.room_id);
        return {
          id: row.id,
          patientId: row.patient_id ?? patientId,
          assignmentId: row.assignment_id ?? undefined,
          roomId: row.room_id ?? undefined,
          overrideScope: scope,
          timestamp: row.timestamp,
          timelineEntryId: row.timeline_entry_id,
          relativeOffsetHours: row.relative_offset_hours,
          temperature: row.temperature ?? undefined,
          bloodPressureSystolic: row.blood_pressure_systolic ?? undefined,
          bloodPressureDiastolic: row.blood_pressure_diastolic ?? undefined,
          heartRate: row.heart_rate ?? undefined,
          respiratoryRate: row.respiratory_rate ?? undefined,
          oxygenSaturation: row.oxygen_saturation ?? undefined,
          pain: row.pain ?? undefined,
          weight: row.weight ?? undefined,
          height: row.height ?? undefined,
          deletedAt: row.deleted_at,
        };
      })
      .filter((vital) =>
        scopeMatchesContext(
          vital.overrideScope ?? 'baseline',
          vital.roomId ?? null,
          targetRooms,
          vital.assignmentId ?? null,
          assignmentId,
        ),
      );
  },

  async addVitals(vitals: VitalSigns[], roomId?: number | null): Promise<void> {
    if (!vitals.length) return;
    
    // Check if all vitals are baseline scope (no assignment, no room)
    const allBaseline = vitals.every((vital) => {
      const scope = deriveScope(vital.overrideScope, vital.assignmentId, vital.roomId ?? roomId ?? null);
      return scope === 'baseline';
    });

    // If all vitals are baseline, update latest for single saves or insert for generated runs
    if (allBaseline && vitals.length > 0) {
      const patientId = vitals[0].patientId;
      const baselinePayload = vitals.map((vital) => ({
        patient_id: vital.patientId,
        assignment_id: null,
        room_id: null,
        override_scope: 'baseline' as const,
        timestamp: vital.timestamp ?? new Date().toISOString(),
        temperature: vital.temperature,
        blood_pressure_systolic: vital.bloodPressureSystolic,
        blood_pressure_diastolic: vital.bloodPressureDiastolic,
        heart_rate: vital.heartRate,
        respiratory_rate: vital.respiratoryRate,
        oxygen_saturation: vital.oxygenSaturation,
        pain: vital.pain,
        weight: vital.weight,
        height: vital.height,
      }));

      if (vitals.length > 1) {
        const { error } = await supabase.from('vital_signs').insert(baselinePayload);
        if (error) {
          console.error('Error inserting baseline vitals', error);
        }
        return;
      }

      // Fetch latest baseline vital for this patient
      const { data: existingVitals } = await supabase
        .from('vital_signs')
        .select('id, timestamp')
        .eq('patient_id', patientId)
        .eq('override_scope', 'baseline')
        .is('assignment_id', null)
        .is('room_id', null)
        .is('deleted_at', null)
        .order('timestamp', { ascending: false })
        .limit(1);

      const baselineTimestamp =
        vitals[0].timestamp ?? existingVitals?.[0]?.timestamp ?? new Date().toISOString();

      const vitalData = {
        ...baselinePayload[0],
        timestamp: baselineTimestamp,
      };

      if (existingVitals && existingVitals.length > 0) {
        const { error } = await supabase
          .from('vital_signs')
          .update(vitalData)
          .eq('id', existingVitals[0].id);
        if (error) {
          console.error('Error updating baseline vital', error);
        }
      } else {
        const { error } = await supabase.from('vital_signs').insert(vitalData);
        if (error) {
          console.error('Error inserting baseline vital', error);
        }
      }
    } else {
      // For non-baseline vitals (room/assignment scoped), insert as new entries
      const payload = vitals.map((v) => ({
        patient_id: v.patientId,
        assignment_id: v.assignmentId ?? null,
        room_id: v.roomId ?? roomId ?? null,
        override_scope: deriveScope(v.overrideScope, v.assignmentId, v.roomId ?? roomId ?? null),
        timestamp: v.timestamp,
        temperature: v.temperature,
        blood_pressure_systolic: v.bloodPressureSystolic,
        blood_pressure_diastolic: v.bloodPressureDiastolic,
        heart_rate: v.heartRate,
        respiratory_rate: v.respiratoryRate,
        oxygen_saturation: v.oxygenSaturation,
        pain: v.pain,
        weight: v.weight,
        height: v.height,
      }));
      const { error } = await supabase.from('vital_signs').insert(payload);
      if (error) {
        console.error('Error inserting vitals', error);
      }
    }
  },

  async listOrders(patientId: string, assignmentId?: string, roomId?: number | null, onError?: (message: string) => void): Promise<MedicalOrder[]> {
    const targetRooms = await getRoomLineage(roomId);
    const { data, error } = await supabase
      .from('medical_orders')
      .select('*')
      .eq('patient_id', patientId)
      .is('deleted_at', null)
      .order('order_time', { ascending: false });

    if (error) {
      console.error('Error fetching orders', error);
      onError?.('Unable to load saved medical orders. Refresh the chart and try again.');
      return [];
    }

    const currentOrders = (data ?? [])
      .map((row) => {
        return mapMedicalOrder(row, patientId);
      })
      .filter((order) => scopeMatchesContext(
        order.overrideScope ?? 'baseline',
        order.roomId ?? null,
        targetRooms,
        order.assignmentId ?? null,
        assignmentId,
      ));
    // Room/EMR authoring and other baseline consumers intentionally have no
    // assignment contract. Do not query student_room_assignments with an
    // undefined id; that is an invalid PostgREST request and can hide the
    // authored baseline orders.
    if (!assignmentId) return currentOrders;
    const { data: assignmentMeta, error: assignmentMetaError } = await supabase
      .from('student_room_assignments')
      .select('case_key_version')
      .eq('id', assignmentId)
      .maybeSingle();
    if (assignmentMetaError) {
      onError?.('Unable to resolve this assignment\'s order contract. Refresh the chart and try again.');
      return currentOrders.filter((order) => order.category !== 'Medication' || order.assignmentId === assignmentId);
    }
    if (!assignmentMeta?.case_key_version) return currentOrders;

    // A case key alone is not a MAR contract. Only an actual materialization
    // receipt authorizes frozen medication routing; this preserves legacy
    // non-MAR case-key assignments without falling back for new pinned ones.
    const { data: receipt, error: receiptError } = await supabase
      .from('mar_assignment_materialization_operations')
      .select('assignment_id,published_content_hash')
      .eq('assignment_id', assignmentId)
      .maybeSingle();
    if (receiptError) {
      // A failed receipt lookup is not evidence that this is a legacy case.
      // Never fall back to mutable medication metadata for a pinned contract.
      onError?.('Unable to verify this assignment\'s MAR materialization. Refresh the chart and try again.');
      return currentOrders.filter((order) => order.category !== 'Medication' || order.assignmentId === assignmentId);
    }
    if (!receipt) {
      // A non-MAR legacy case key has no authored MAR version. Preserve its
      // established Orders behavior; a published MAR version without a
      // materialization receipt is instead an incomplete new contract.
      const { data: authoredVersion, error: authoredVersionError } = await supabase
        .from('mar_authored_case_versions')
        .select('case_version')
        .eq('room_id', roomId ?? -1)
        .eq('case_version', assignmentMeta.case_key_version)
        .maybeSingle();
      if (authoredVersionError) {
        onError?.('Unable to resolve this assignment\'s authored MAR version. Refresh the chart and try again.');
        return currentOrders.filter((order) => order.category !== 'Medication' || order.assignmentId === assignmentId);
      }
      if (!authoredVersion) return currentOrders;
      onError?.('Pinned medication orders are unavailable until this assignment has a MAR materialization receipt.');
      return currentOrders.filter((order) => order.category !== 'Medication' || order.assignmentId === assignmentId);
    }

    const { data: snapshot, error: snapshotError } = await supabase.rpc('get_mar_assignment_order_snapshot', {
      p_assignment_id: assignmentId,
    });
    if (snapshotError || !Array.isArray(snapshot)) {
      onError?.('Unable to load the pinned medication orders for this assignment. Refresh the chart and try again.');
      return currentOrders.filter((order) => order.category !== 'Medication' || order.assignmentId === assignmentId);
    }
    const frozenMedicationOrders = (snapshot as MedicalOrderRow[]).map((row) => mapMedicalOrder(row, patientId));
    const preservedOrders = currentOrders.filter((order) => order.category !== 'Medication' || order.assignmentId === assignmentId);
    const byId = new Map(preservedOrders.map((order) => [order.id, order]));
    frozenMedicationOrders.forEach((order) => byId.set(order.id, order));
    return Array.from(byId.values());
  },

  /**
   * MAR-only frozen medication reader. General Orders/Labs/Imaging consumers
   * must continue reading their own assignment-scoped orders, including
   * legacy assignments that predate MAR snapshots.
   */
  async listMarMedicationOrders(patientId: string, assignmentId: string, onError?: (message: string) => void): Promise<MedicalOrder[]> {
    const { data: snapshot, error } = await supabase.rpc('get_mar_assignment_order_snapshot', {
      p_assignment_id: assignmentId,
    });
    if (error) {
      console.error('Error fetching pinned MAR medication orders', error);
      onError?.('Unable to load the pinned medication orders for this assignment. Refresh the chart and try again.');
      return [];
    }
    if (!Array.isArray(snapshot)) {
      onError?.('Pinned medication orders are unavailable for this assignment.');
      return [];
    }
    const frozen = (snapshot as MedicalOrderRow[]).map((row) => mapMedicalOrder(row, patientId));
    const { data: learnerOrders, error: learnerOrderError } = await supabase
      .from('medical_orders')
      .select('*')
      .eq('patient_id', patientId)
      .eq('assignment_id', assignmentId)
      .eq('category', 'Medication')
      .is('deleted_at', null)
      .order('order_time', { ascending: false });
    if (learnerOrderError) {
      console.error('Error fetching learner medication orders', learnerOrderError);
      onError?.('Unable to load learner medication orders for this assignment.');
      return frozen;
    }
    const byId = new Map(frozen.map((order) => [order.id, order]));
    (learnerOrders ?? []).map((row) => mapMedicalOrder(row, patientId)).forEach((order) => {
      if (!byId.has(order.id)) byId.set(order.id, order);
    });
    return Array.from(byId.values());
  },

  async listMarEvents(
    patientId: string,
    assignmentId?: string,
    roomId?: number | null,
    caseVersion?: string | null,
    onError?: (message: string) => void,
  ): Promise<MarAdministrationEvent[]> {
    const targetRooms = await getRoomLineage(roomId);
    let query = supabase.from('mar_administration_events').select('*').eq('patient_id', patientId).is('deleted_at', null);
    if (assignmentId) query = query.or(`assignment_id.eq.${assignmentId},assignment_id.is.null`);
    else query = query.is('assignment_id', null);
    if (caseVersion) query = query.eq('case_version', caseVersion);
    const { data, error } = await query.order('relative_offset_hours', { ascending: true }).order('administered_at', { ascending: true });
    if (error) {
      console.error('Error fetching MAR history', error);
      onError?.('Unable to load MAR history. Refresh the chart and try again.');
      return [];
    }
    return (data ?? []).map(mapMarEvent).filter((event) => {
      if (!roomId) return event.assignmentId === (assignmentId ?? null);
      return (targetRooms ?? [roomId]).includes(event.roomId) && event.assignmentId === (assignmentId ?? null);
    });
  },

  async getMarBaselineVersion(assignmentId: string): Promise<{ caseVersion: string; contentHash: string } | null> {
    const { data, error } = await supabase
      .from('mar_assignment_baseline_versions')
      .select('case_version, content_hash')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return { caseVersion: data.case_version, contentHash: data.content_hash };
  },

  async getMarReadiness(): Promise<boolean> {
    const { data, error } = await supabase.rpc('get_mar_readiness');
    if (error) return false;
    return Boolean((data as { ready?: boolean } | null)?.ready);
  },

  async getMarNormalMaterializationReadiness(): Promise<{ ready: boolean; materializationVersion: number; publicationPreviewVersion: number; atomic: boolean }> {
    const { data, error } = await supabase.rpc('get_mar_normal_materialization_readiness');
    if (error || !data || typeof data !== 'object') return { ready: false, materializationVersion: 0, publicationPreviewVersion: 0, atomic: false };
    const value = data as { ready?: boolean; materializationVersion?: number; publicationPreviewVersion?: number; atomic?: boolean };
    return { ready: Boolean(value.ready), materializationVersion: Number(value.materializationVersion ?? 0), publicationPreviewVersion: Number(value.publicationPreviewVersion ?? 0), atomic: Boolean(value.atomic) };
  },

  async getPublishedMarCaseVersion(roomId: number): Promise<string | null> {
    const { data, error } = await supabase.rpc('get_mar_published_case_version', { p_room_id: roomId });
    if (error || !data || typeof data !== 'object') return null;
    const value = data as { caseVersion?: unknown };
    return typeof value.caseVersion === 'string' && value.caseVersion.trim() ? value.caseVersion : null;
  },

  async getMarPublicationPreview(roomId: number): Promise<{ revision: number; contentHash: string; orderCount: number; eventCount: number }> {
    const { data, error } = await supabase.rpc('get_mar_publication_preview', { p_room_id: roomId });
    if (error) throw error;
    const value = data as Partial<{ revision: number; contentHash: string; orderCount: number; eventCount: number }> | null;
    if (!value?.contentHash) throw new Error('MAR publication preview is unavailable. Reload the authored Orders and MAR history.');
    return {
      revision: Number(value.revision ?? 0),
      contentHash: value.contentHash,
      orderCount: Number(value.orderCount ?? 0),
      eventCount: Number(value.eventCount ?? 0),
    };
  },

  async getMarPublicationStatus(requestId: string): Promise<{ committed: boolean; result?: unknown }> {
    const { data, error } = await supabase
      .from('mar_publication_operations')
      .select('request_id,result')
      .eq('request_id', requestId)
      .maybeSingle();
    if (error) throw error;
    return data ? { committed: true, result: data.result } : { committed: false };
  },

  async publishMarCaseVersion(
    roomId: number,
    options: { requestId: string; expectedRevision: number; expectedContentHash?: string | null; requestedVersion?: string | null },
  ): Promise<{ caseVersion: string; contentHash: string; orderCount: number; eventCount: number; revision: number; requestId: string }> {
    const { data, error } = await supabase.rpc('publish_mar_case_version_atomic', {
      p_request_id: options.requestId,
      p_room_id: roomId,
      p_expected_revision: options.expectedRevision,
      p_expected_content_hash: options.expectedContentHash ?? null,
      p_case_version: options.requestedVersion ?? null,
    });
    if (error) throw error;
    const value = data as Partial<{ caseVersion: string; contentHash: string; orderCount: number; eventCount: number; revision: number; requestId: string }> | null;
    if (!value?.caseVersion || !value.contentHash) throw new Error('MAR version publication returned no immutable version.');
    return {
      caseVersion: value.caseVersion,
      contentHash: value.contentHash,
      orderCount: Number(value.orderCount ?? 0),
      eventCount: Number(value.eventCount ?? 0),
      revision: Number(value.revision ?? options.expectedRevision),
      requestId: value.requestId ?? options.requestId,
    };
  },

  async saveMarHistory(
    patientId: string,
    roomId: number,
    assignmentId: string | null,
    caseVersion: string | null,
    expectedRevision: number,
    events: MarAdministrationEvent[],
    requestId: string = crypto.randomUUID(),
  ): Promise<{ ok: true; revision: number } | { ok: false; error: string }> {
    const { data, error } = await supabase.rpc('save_mar_history_atomic', {
      p_request_id: requestId,
      p_patient_id: patientId,
      p_room_id: roomId,
      p_assignment_id: assignmentId,
      p_case_version: caseVersion,
      p_expected_revision: expectedRevision,
      p_events: events.map((event) => ({
        id: event.id,
        orderId: event.orderId,
        caseVersion: event.caseVersion ?? caseVersion,
        occurrenceKey: event.occurrenceKey,
        relativeOffsetHours: event.relativeOffsetHours,
        administeredAt: event.administeredAt,
        medicationName: event.medicationName,
        orderedDose: event.orderedDose,
        administeredDose: event.administeredDose,
        unit: event.unit,
        route: event.route,
        frequency: event.frequency,
        category: event.category,
        status: event.status,
        simulatedClinician: event.simulatedClinician,
        reason: event.reason,
        prnIndication: event.prnIndication,
        response: event.response,
        infusionDetails: event.infusionDetails,
        source: event.source,
        actorLabel: event.actorLabel,
      })),
    });
    if (error) {
      console.error('Error saving MAR history', error);
      const message = marRpcErrorMessage(error);
      return { ok: false, error: message.includes('MAR_REVISION_CONFLICT')
        ? 'MAR changed in another window. Reload the preview before saving.'
        : message };
    }
    const revision = Number((data as { revision?: number } | null)?.revision);
    return { ok: true, revision: Number.isFinite(revision) ? revision : expectedRevision + 1 };
  },

  async getMarHistoryRevision(patientId: string, roomId: number, assignmentId: string | null): Promise<number> {
    const { data, error } = await supabase.rpc('get_mar_history_revision', {
      p_patient_id: patientId,
      p_room_id: roomId,
      p_assignment_id: assignmentId,
    });
    if (error) {
      console.error('Error fetching MAR revision', error);
      return 0;
    }
    return Number(data ?? 0);
  },

  async addOrder(order: MedicalOrder, roomId?: number | null): Promise<MedicalOrder | null> {
    const overrideScope = deriveScope(order.overrideScope, order.assignmentId, order.roomId ?? roomId ?? null);
    const { data, error } = await supabase.from('medical_orders').insert({
      patient_id: order.patientId,
      assignment_id: order.assignmentId ?? null,
      room_id: order.roomId ?? roomId ?? null,
      override_scope: overrideScope,
      category: order.category,
      order_name: order.orderName,
      frequency: order.frequency,
      route: order.route,
      dose: order.dose,
      priority: order.priority,
      status: order.status,
      ordered_by: order.orderedBy,
      order_time: order.orderTime,
      scheduled_time: order.scheduledTime,
      instructions: order.instructions,
      result_failure_reason: order.resultFailureReason ?? null,
      result_attempt_key: order.resultAttemptKey ?? null,
      result_generation_status: order.resultGenerationStatus ?? 'not_started',
    }).select('*').maybeSingle();
    if (error) {
      console.error('Error inserting order', error);
      return null;
    }
    return data ? mapMedicalOrder(data, order.patientId) : null;
  },

  async updateOrder(
    orderId: string,
    updates: Partial<MedicalOrder>,
    expectedVersion?: number,
  ): Promise<VersionedMutationResult<MedicalOrder>> {
    let query = supabase
      .from('medical_orders')
      .update({
        order_name: updates.orderName,
        frequency: updates.frequency,
        route: updates.route,
        dose: updates.dose,
        priority: updates.priority,
        status: updates.status,
        instructions: updates.instructions,
        ordered_by: updates.orderedBy,
        result_failure_reason: updates.resultFailureReason,
        result_attempt_key: updates.resultAttemptKey,
        result_generation_status: updates.resultGenerationStatus,
      })
      .eq('id', orderId);
    if (expectedVersion !== undefined) query = query.eq('record_version', expectedVersion);
    const { error, data } = await query.select('*').maybeSingle();

    if (error) {
      console.error('Error updating order', error);
      return null;
    }
    if (!data) {
      if (expectedVersion === undefined) return null;
      const { data: current, error: currentError } = await supabase
        .from('medical_orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();
      if (currentError || !current) return null;
      return { conflict: true, current: mapMedicalOrder(current), expectedVersion };
    }

    return mapMedicalOrder(data);
  },

  async deleteOrder(orderId: string): Promise<void> {
    const { error } = await supabase
      .from('medical_orders')
      .update({ deleted_at: new Date().toISOString(), status: 'Discontinued' })
      .eq('id', orderId);
    if (error) {
      console.error('Error deleting order', error);
    }
  },

  async listImagingStudies(
    patientId: string,
    assignmentId?: string,
    roomId?: number | null,
  ): Promise<ImagingStudy[]> {
    const targetRooms = await getRoomLineage(roomId);
    const [{ data, error }, placedOrdersResult] = await Promise.all([
      supabase
        .from('imaging_studies')
        .select('*')
        .eq('patient_id', patientId)
        .is('deleted_at', null)
        .order('order_time', { ascending: false }),
      assignmentId
        ? supabase
            .from('medical_orders')
            .select('order_name, assignment_id, room_id, override_scope, status')
            .eq('patient_id', patientId)
            .eq('category', 'Imaging')
            .is('deleted_at', null)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (error) {
      console.error('Error fetching imaging studies', error);
      return [];
    }
    if (placedOrdersResult.error) {
      console.error('Error fetching imaging orders for result gating', placedOrdersResult.error);
      return [];
    }

    const placedOrderNames = (placedOrdersResult.data ?? [])
      .filter((order) =>
        scopeMatchesContext(
          deriveScope(order.override_scope, order.assignment_id, order.room_id),
          order.room_id,
          targetRooms,
          order.assignment_id,
          assignmentId,
        ),
      )
      .map((order) => order.order_name);

    return (data ?? [])
      .map((row) => mapImagingStudy(row, patientId))
      .filter((study) =>
        scopeMatchesContext(
          study.overrideScope ?? 'baseline',
          study.roomId ?? null,
          targetRooms,
          study.assignmentId ?? null,
          assignmentId,
        ),
      )
      .filter((study) =>
        !assignmentId ||
        (study.overrideScope === 'assignment' && study.assignmentId === assignmentId) ||
        placedOrderNames.some((orderName) =>
          imagingOrderMatchesStudy(orderName, study.orderName ?? study.studyType),
        ),
      );
  },

  async addImagingStudy(study: ImagingStudy): Promise<ImagingStudy | null> {
    const overrideScope = deriveScope(study.overrideScope, study.assignmentId, study.roomId ?? null);
    const { data, error } = await supabase
      .from('imaging_studies')
      .insert({
        id: study.id,
        patient_id: study.patientId,
        assignment_id: study.assignmentId ?? null,
        room_id: study.roomId ?? null,
        override_scope: overrideScope,
        order_name: study.orderName ?? null,
        study_type: study.studyType,
        contrast: study.contrast ?? null,
        priority: study.priority ?? null,
        status: study.status ?? null,
        ordered_by: study.orderedBy ?? null,
        order_time: study.orderTime ?? new Date().toISOString(),
        report: study.report ?? null,
        report_generated_at: study.reportGeneratedAt ?? null,
        images: study.images ?? [],
      })
      .select('*')
      .maybeSingle();

    if (error || !data) {
      console.error('Error inserting imaging study', error);
      return null;
    }

    return mapImagingStudy(data, study.patientId);
  },

  async updateImagingStudy(
    studyId: string,
    updates: Partial<Pick<ImagingStudy, 'report' | 'reportGeneratedAt' | 'status' | 'images' | 'bodySite' | 'laterality' | 'indication' | 'findings' | 'impression' | 'encounterTime' | 'contrast'>> & { expectedVersion?: number },
  ): Promise<ImagingStudy | null> {
    const { data: existing, error: existingError } = await supabase
      .from('imaging_studies')
      .select('*')
      .eq('id', studyId)
      .maybeSingle();
    if (existingError || !existing) return null;
    if (updates.expectedVersion !== undefined && existing.record_version !== updates.expectedVersion) {
      console.error('Imaging report edit conflict', { studyId, expected: updates.expectedVersion, actual: existing.record_version });
      return null;
    }
    const payload = {
      report: updates.report,
      report_generated_at: updates.reportGeneratedAt,
      status: updates.status,
      images: updates.images,
      body_site: updates.bodySite,
      laterality: updates.laterality,
      indication: updates.indication,
      findings: updates.findings,
      impression: updates.impression,
      encounter_time: updates.encounterTime,
      record_version: updates.expectedVersion !== undefined ? updates.expectedVersion + 1 : undefined,
    };
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );

    let query = supabase
      .from('imaging_studies')
      .update(cleanPayload)
      .eq('id', studyId);
    if (updates.expectedVersion !== undefined) query = query.eq('record_version', updates.expectedVersion);
    const { data, error } = await query.select('*').maybeSingle();

    if (error || !data) {
      console.error('Error updating imaging study', error);
      return null;
    }

    const nextVersion = data.record_version ?? (existing.record_version + 1);
    await supabase.from('imaging_study_versions').upsert({
      study_id: studyId,
      version: nextVersion,
      report: data.report,
      body_site: data.body_site,
      laterality: data.laterality,
      contrast: data.contrast,
      indication: data.indication,
      findings: data.findings,
      impression: data.impression,
      status: data.status,
      encounter_time: data.encounter_time,
      is_addendum: false,
    }, { onConflict: 'study_id,version' });

    return mapImagingStudy(data, data.patient_id ?? '');
  },

  async deleteImagingStudy(studyId: string): Promise<boolean> {
    const { error } = await supabase
      .from('imaging_studies')
      .update({ deleted_at: new Date().toISOString(), status: 'Deleted' })
      .eq('id', studyId);
    if (error) {
      console.error('Error deleting imaging study', error);
      return false;
    }
    return true;
  },

  async getRoomOrdersConfig(roomId: number): Promise<RoomOrdersConfig | null> {
    const { data, error } = await supabase
      .from('rooms')
      .select('orders_config')
      .eq('id', roomId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching room orders config', error);
      return null;
    }

    const ordersConfig = (data?.orders_config ?? null) as RoomOrdersConfig | null;
    if (ordersConfig && Array.isArray(ordersConfig.labs)) {
      return ordersConfig;
    }

    return null;
  },

  async updatePatientCustomSections(
    patientId: string,
    sections: CustomOverviewSection[],
  ): Promise<CustomOverviewSection[] | null> {
    const payload = { sections };
    const { data, error } = await supabase
      .from('patients')
      .update({ custom_overview_sections: payload })
      .eq('id', patientId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('Error updating custom overview sections', error);
      return null;
    }

    return (data?.custom_overview_sections as { sections?: CustomOverviewSection[] } | null | undefined)?.sections ?? [];
  },

  async updatePatientIntakeOutput(patientId: string, intakeOutput: IntakeOutput): Promise<IntakeOutput | null> {
    const { data, error } = await supabase
      .from('patients')
      .update({ intake_output: intakeOutput })
      .eq('id', patientId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('Error updating intake/output', error);
      return null;
    }

    return (data?.intake_output as IntakeOutput | null | undefined) ?? null;
  },

  async updatePatient(
    patientId: string,
    payload: Partial<Pick<Patient, 'firstName' | 'lastName' | 'mrn' | 'dateOfBirth' | 'gender' | 'allergies' | 'roomId' | 'service'>>,
  ): Promise<Patient | null> {
    const { data, error } = await supabase
      .from('patients')
      .update({
        first_name: payload.firstName,
        last_name: payload.lastName,
        mrn: payload.mrn,
        date_of_birth: payload.dateOfBirth,
        gender: payload.gender,
        allergies: payload.allergies,
        room_id: payload.roomId ?? null,
        service: payload.service,
      })
      .eq('id', patientId)
      .select('*')
      .maybeSingle();

    if (error || !data) {
      if (error) console.error('Error updating patient', error);
      return null;
    }
    return mapPatient(data);
  },

  async updateRoom(roomId: number, payload: Partial<{ room_number: string }>): Promise<void> {
    const { error } = await supabase
      .from('rooms')
      .update({
        room_number: payload.room_number,
      })
      .eq('id', roomId);
    if (error) {
      console.error('Error updating room', error);
    }
  },
};
