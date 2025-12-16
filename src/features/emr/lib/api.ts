import { supabase } from '../../../lib/supabase';
import type { Database } from '../../../lib/database.types';
import type {
  Patient,
  ClinicalNote,
  LabResult,
  VitalSigns,
  MedicalOrder,
  RoomOrdersConfig,
  CustomOverviewSection,
  IntakeOutput,
} from './types';

type OverrideScope = 'baseline' | 'room' | 'assignment';
type RoomLineage = number[];
type ClinicalNoteRow = Database['public']['Tables']['clinical_notes']['Row'];

const deriveScope = (
  overrideScope: string | null | undefined,
  assignmentId?: string | null,
  roomId?: number | null,
): OverrideScope => {
  if (overrideScope === 'assignment' || overrideScope === 'room' || overrideScope === 'baseline') {
    return overrideScope;
  }
  if (assignmentId) return 'assignment';
  if (roomId) return 'room';
  return 'baseline';
};

const scopeMatchesContext = (
  scope: OverrideScope,
  rowRoomId: number | null,
  targetRoomIds?: RoomLineage | null,
  rowAssignmentId?: string | null,
  targetAssignmentId?: string | null,
) => {
  if (scope === 'assignment') {
    return Boolean(targetAssignmentId && rowAssignmentId === targetAssignmentId);
  }
  if (scope === 'room') {
    if (!targetRoomIds || targetRoomIds.length === 0) return true;
    return targetRoomIds.includes(rowRoomId ?? -1);
  }
  return true;
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
  };
};

export const emrApi = {
  async getPatient(patientId: string): Promise<Patient | null> {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', patientId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !data) {
      if (error) {
        console.error('Error fetching patient', error);
      }
      return null;
    }

    return mapPatient(data);
  },

  async getPatientByRoomId(roomId: number): Promise<Patient | null> {
    const { data, error } = await supabase
      .from('rooms')
      .select('patient_id, patient:patient_id(*)')
      .eq('id', roomId)
      .maybeSingle();

    if (data?.patient) {
      return mapPatient(data.patient as Database['public']['Tables']['patients']['Row'], roomId);
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
      .select('*')
      .is('deleted_at', null)
      .order('last_name');

    if (error) {
      console.error('Error fetching patients', error);
      return [];
    }

    return (data ?? []).map(mapPatient);
  },

  async listPatientsForStudent(studentId: string): Promise<Patient[]> {
    const { data, error } = await supabase
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
      .in('status', ['assigned', 'in_progress', 'completed']);

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

  async listClinicalNotes(patientId: string, assignmentId?: string, roomId?: number | null): Promise<ClinicalNote[]> {
    const targetRooms = await getRoomLineage(roomId);
    const { data, error } = await supabase
      .from('clinical_notes')
      .select('*')
      .eq('patient_id', patientId)
      .is('deleted_at', null)
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('Error fetching clinical notes', error);
      return [];
    }

    return (data ?? [])
      .map((row) => mapClinicalNote(row, patientId))
      .filter((note) =>
        scopeMatchesContext(
          note.overrideScope ?? 'baseline',
          note.roomId ?? null,
          targetRooms,
          note.assignmentId ?? null,
          assignmentId,
        ),
      );
  },

  async addClinicalNote(note: ClinicalNote): Promise<void> {
    const overrideScope = deriveScope(note.overrideScope, note.assignmentId, note.roomId);
    const { error } = await supabase.from('clinical_notes').insert({
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
    });

    if (error) {
      console.error('Error inserting clinical note', error);
    }
  },

  async updateClinicalNote(
    noteId: string,
    updates: Partial<Pick<ClinicalNote, 'title' | 'content' | 'type' | 'signed'>>,
  ): Promise<ClinicalNote | null> {
    const payload = {
      title: updates.title,
      content: updates.content,
      note_type: updates.type,
      signed: updates.signed,
    };
    const cleanPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    );
    const { data, error } = await supabase
      .from('clinical_notes')
      .update(cleanPayload)
      .eq('id', noteId)
      .select('*')
      .maybeSingle();

    if (error || !data) {
      console.error('Error updating clinical note', error);
      return null;
    }

    return mapClinicalNote(data, data.patient_id ?? '');
  },

  async listLabResults(patientId: string, assignmentId?: string, roomId?: number | null): Promise<LabResult[]> {
    const targetRooms = await getRoomLineage(roomId);
    const { data, error } = await supabase
      .from('lab_results')
      .select('*')
      .eq('patient_id', patientId)
      .is('deleted_at', null)
      .order('collection_time', { ascending: false });

    if (error) {
      console.error('Error fetching labs', error);
      return [];
    }

    return (data ?? [])
      .map((row) => {
        const scope = deriveScope(row.override_scope, row.assignment_id, row.room_id);
        return {
          id: row.id,
          patientId: row.patient_id ?? patientId,
          assignmentId: row.assignment_id,
          roomId: row.room_id ?? undefined,
          overrideScope: scope,
          testName: row.test_name,
          value: row.value ?? '',
          unit: row.unit ?? '',
          referenceRange: row.reference_range ?? '',
          status: (row.status as LabResult['status']) ?? 'Pending',
          collectionTime: row.collection_time ?? new Date().toISOString(),
          resultTime: row.result_time ?? undefined,
          orderedBy: row.ordered_by ?? 'Unknown',
          deletedAt: row.deleted_at,
        };
      })
      .filter((lab) =>
        scopeMatchesContext(
          lab.overrideScope ?? 'baseline',
          lab.roomId ?? null,
          targetRooms,
          lab.assignmentId ?? null,
          assignmentId,
        ),
      );
  },

  async addLabResults(labs: LabResult[], roomId?: number | null): Promise<void> {
    if (!labs.length) return;
    
    // Check if all labs are baseline scope (no assignment, no room)
    const allBaseline = labs.every((lab) => {
      const scope = deriveScope(lab.overrideScope, lab.assignmentId, lab.roomId ?? roomId ?? null);
      return scope === 'baseline';
    });

    // If all labs are baseline, merge with existing baseline labs
    if (allBaseline && labs.length > 0) {
      const patientId = labs[0].patientId;
      
      // Fetch existing baseline labs for this patient
      const { data: existingLabs } = await supabase
        .from('lab_results')
        .select('*')
        .eq('patient_id', patientId)
        .eq('override_scope', 'baseline')
        .is('assignment_id', null)
        .is('room_id', null)
        .is('deleted_at', null);

      // Create a map of existing labs by test name
      const existingLabMap = new Map(
        (existingLabs ?? []).map((lab) => [lab.test_name, lab])
      );

      const labsToInsert = [];
      const labsToUpdate = [];

      for (const lab of labs) {
        const existingLab = existingLabMap.get(lab.testName);
        const labData = {
          patient_id: lab.patientId,
          assignment_id: null,
          room_id: null,
          override_scope: 'baseline' as const,
          test_name: lab.testName,
          value: typeof lab.value === 'number' ? lab.value : Number(lab.value) || null,
          unit: lab.unit,
          reference_range: lab.referenceRange,
          status: lab.status,
          collection_time: lab.collectionTime,
          result_time: lab.resultTime,
          ordered_by: lab.orderedBy,
        };

        if (existingLab) {
          // Update existing lab
          labsToUpdate.push({ id: existingLab.id, data: labData });
        } else {
          // Insert new lab
          labsToInsert.push(labData);
        }
      }

      // Perform updates
      for (const { id, data } of labsToUpdate) {
        const { error } = await supabase
          .from('lab_results')
          .update(data)
          .eq('id', id);
        if (error) {
          console.error('Error updating baseline lab', error);
        }
      }

      // Perform inserts
      if (labsToInsert.length > 0) {
        const { error } = await supabase.from('lab_results').insert(labsToInsert);
        if (error) {
          console.error('Error inserting baseline labs', error);
        }
      }
    } else {
      // For non-baseline labs (room/assignment scoped), insert as new entries
      const payload = labs.map((lab) => ({
        patient_id: lab.patientId,
        assignment_id: lab.assignmentId ?? null,
        room_id: lab.roomId ?? roomId ?? null,
        override_scope: deriveScope(lab.overrideScope, lab.assignmentId, lab.roomId ?? roomId ?? null),
        test_name: lab.testName,
        value: typeof lab.value === 'number' ? lab.value : Number(lab.value) || null,
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
      }
    }
  },

  async listVitals(patientId: string, assignmentId?: string, roomId?: number | null): Promise<VitalSigns[]> {
    const targetRooms = await getRoomLineage(roomId);
    const { data, error } = await supabase
      .from('vital_signs')
      .select('*')
      .eq('patient_id', patientId)
      .is('deleted_at', null)
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
  },

  async listOrders(patientId: string, assignmentId?: string, roomId?: number | null): Promise<MedicalOrder[]> {
    const targetRooms = await getRoomLineage(roomId);
    const { data, error } = await supabase
      .from('medical_orders')
      .select('*')
      .eq('patient_id', patientId)
      .is('deleted_at', null)
      .order('order_time', { ascending: false });

    if (error) {
      console.error('Error fetching orders', error);
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
          deletedAt: row.deleted_at,
        };
      })
      .filter((order) =>
        scopeMatchesContext(
          order.overrideScope ?? 'baseline',
          order.roomId ?? null,
          targetRooms,
          order.assignmentId ?? null,
          assignmentId,
        ),
      );
  },

  async addOrder(order: MedicalOrder, roomId?: number | null): Promise<void> {
    const overrideScope = deriveScope(order.overrideScope, order.assignmentId, order.roomId ?? roomId ?? null);
    const { error } = await supabase.from('medical_orders').insert({
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
    });
    if (error) {
      console.error('Error inserting order', error);
    }
  },

  async updateOrder(orderId: string, updates: Partial<MedicalOrder>): Promise<MedicalOrder | null> {
    const { error, data } = await supabase
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
      })
      .eq('id', orderId)
      .select('*')
      .maybeSingle();

    if (error || !data) {
      if (error) console.error('Error updating order', error);
      return null;
    }

    const scope = deriveScope(data.override_scope, data.assignment_id, data.room_id);
    return {
      id: data.id,
      patientId: data.patient_id ?? '',
      assignmentId: data.assignment_id ?? undefined,
      roomId: data.room_id ?? undefined,
      overrideScope: scope,
      category: data.category as MedicalOrder['category'],
      orderName: data.order_name,
      frequency: data.frequency ?? undefined,
      route: data.route ?? undefined,
      dose: data.dose ?? undefined,
      priority: (data.priority as MedicalOrder['priority']) ?? 'Routine',
      status: (data.status as MedicalOrder['status']) ?? 'Active',
      orderedBy: data.ordered_by ?? 'Unknown',
      orderTime: data.order_time ?? new Date().toISOString(),
      scheduledTime: data.scheduled_time ?? undefined,
      instructions: data.instructions ?? undefined,
      deletedAt: data.deleted_at,
    };
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
