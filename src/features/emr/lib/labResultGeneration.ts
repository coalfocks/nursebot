import { supabase } from '../../../lib/supabase';
import type { ClinicalNote, LabResult, Patient, VitalSigns } from './types';
import { resolveLabTemplates, validateGeneratedLabResults, type GeneratedLabPayload } from './aiLabGenerator';

type RoomContext = {
  emrContext?: unknown;
  nurseContext?: string | null;
  expectedDiagnosis?: string | null;
  expectedTreatment?: string[] | null;
  caseGoals?: string | null;
  objective?: string | null;
  progressNote?: string | null;
  completionHint?: string | null;
};

const errorMessage = async (error: unknown) => {
  const fallback = error instanceof Error ? error.message : 'Lab result generation failed.';
  const response = (error as { context?: Response } | null)?.context;
  if (!response?.clone) return fallback;
  try {
    const body = await response.clone().json() as { error?: string; reason?: string };
    return body.error ?? body.reason ?? fallback;
  } catch {
    return fallback;
  }
};

export async function generateCoherentStatLabPanel({
  patient,
  orderName,
  assignmentId,
  roomId,
  room,
  previousLabs,
  clinicalNotes,
  vitals,
  orders,
}: {
  patient: Patient;
  orderName: string;
  assignmentId: string;
  roomId: number;
  room: RoomContext;
  previousLabs: LabResult[];
  clinicalNotes: ClinicalNote[];
  vitals: VitalSigns[];
  orders: Array<{ orderName: string; category: string; priority: string; status: string; instructions?: string }>;
}) {
  const templates = resolveLabTemplates(orderName, patient.gender, patient.dateOfBirth);
  const requestedTests = templates.map((template) => ({ testName: template.testName, unit: template.unit, referenceRange: template.referenceRange }));
  const { data, error } = await supabase.functions.invoke('lab-results', {
    body: {
      orderName,
      priority: 'STAT',
      tests: requestedTests,
      context: {
        patient,
        room: { id: roomId, number: patient.room },
        assignmentId,
        emrContext: room.emrContext ?? null,
        nurseContext: room.nurseContext ?? null,
        expectedDiagnosis: room.expectedDiagnosis ?? null,
        expectedTreatment: room.expectedTreatment ?? null,
        caseGoals: room.caseGoals ?? null,
        objective: room.objective ?? null,
        progressNote: room.progressNote ?? null,
        completionHint: room.completionHint ?? null,
        clinicalNotes: clinicalNotes.slice(0, 6).map((note) => ({ type: note.type, title: note.title, content: note.content })),
        vitals: vitals.slice(0, 6),
        previousLabs: previousLabs.slice(0, 10).map((lab) => ({ testName: lab.testName, value: lab.value, unit: lab.unit, referenceRange: lab.referenceRange, status: lab.status, collectionTime: lab.collectionTime })),
        orders: orders.slice(0, 6),
      },
    },
  });
  if (error) throw new Error(await errorMessage(error));
  const raw = Array.isArray((data as { labs?: unknown } | null)?.labs) ? (data as { labs: GeneratedLabPayload[] }).labs : [];
  const validated = validateGeneratedLabResults(raw, templates, {
    assignmentId,
    orderName,
    previousLabs,
    clinicalNotes,
    vitals,
    caseInstructions: JSON.stringify(room),
  });
  if (!validated || validated.length !== requestedTests.length) {
    throw new Error('Generated lab panel failed clinical coherence validation; no result was saved. Refresh and retry.');
  }
  const timestamp = new Date().toISOString();
  return validated.map((lab, index) => ({
    id: `lab-${crypto.randomUUID()}-${index}`,
    patientId: patient.id,
    assignmentId,
    roomId,
    overrideScope: 'assignment' as const,
    testName: lab.testName ?? requestedTests[index].testName,
    value: lab.value ?? '',
    unit: lab.unit ?? requestedTests[index].unit,
    referenceRange: lab.referenceRange ?? requestedTests[index].referenceRange,
    status: lab.status ?? 'Normal',
    collectionTime: timestamp,
    resultTime: timestamp,
    orderedBy: 'Automated Lab Engine',
  }));
}
