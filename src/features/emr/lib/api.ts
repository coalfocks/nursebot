import { supabase } from '../../../lib/supabase';
import type { Database } from '../../../lib/database.types';
import type {
  Patient,
  ClinicalNote,
  LabResult,
  VitalSigns,
  MedicalOrder,
} from './types';

const mapPatient = (row: Database['public']['Tables']['patients']['Row']): Patient => ({
  id: row.id,
  schoolId: row.school_id,
  roomId: row.room_id,
  mrn: row.mrn,
  firstName: row.first_name,
  lastName: row.last_name,
  dateOfBirth: row.date_of_birth,
  gender: (row.gender as Patient['gender']) ?? 'Other',
  room: undefined,
  service: row.service ?? undefined,
  admissionDate: row.admission_date ?? undefined,
  attendingPhysician: row.attending_physician ?? undefined,
  allergies: row.allergies ?? [],
  codeStatus: (row.code_status as Patient['codeStatus']) ?? undefined,
  deletedAt: row.deleted_at,
});

export const emrApi = {
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

  async listClinicalNotes(patientId: string): Promise<ClinicalNote[]> {
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

    return (data ?? []).map((row) => ({
      id: row.id,
      patientId: row.patient_id ?? patientId,
      type: row.note_type as ClinicalNote['type'],
      title: row.title,
      content: row.content,
      author: row.author ?? 'Unknown',
      timestamp: row.timestamp,
      signed: row.signed ?? false,
    }));
  },

  async addClinicalNote(note: ClinicalNote): Promise<void> {
    const { error } = await supabase.from('clinical_notes').insert({
      patient_id: note.patientId,
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

  async listLabResults(patientId: string): Promise<LabResult[]> {
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

    return (data ?? []).map((row) => ({
      id: row.id,
      patientId: row.patient_id ?? patientId,
      testName: row.test_name,
      value: row.value ?? '',
      unit: row.unit ?? '',
      referenceRange: row.reference_range ?? '',
      status: (row.status as LabResult['status']) ?? 'Pending',
      collectionTime: row.collection_time ?? new Date().toISOString(),
      resultTime: row.result_time ?? undefined,
      orderedBy: row.ordered_by ?? 'Unknown',
      deletedAt: row.deleted_at,
    }));
  },

  async addLabResults(labs: LabResult[]): Promise<void> {
    if (!labs.length) return;
    const payload = labs.map((lab) => ({
      patient_id: lab.patientId,
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
  },

  async listVitals(patientId: string): Promise<VitalSigns[]> {
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

    return (data ?? []).map((row) => ({
      id: row.id,
      patientId: row.patient_id ?? patientId,
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
    }));
  },

  async addVitals(vitals: VitalSigns[]): Promise<void> {
    if (!vitals.length) return;
    const payload = vitals.map((v) => ({
      patient_id: v.patientId,
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

  async listOrders(patientId: string): Promise<MedicalOrder[]> {
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

    return (data ?? []).map((row) => ({
      id: row.id,
      patientId: row.patient_id ?? patientId,
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
    }));
  },

  async addOrder(order: MedicalOrder): Promise<void> {
    const { error } = await supabase.from('medical_orders').insert({
      patient_id: order.patientId,
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
};
