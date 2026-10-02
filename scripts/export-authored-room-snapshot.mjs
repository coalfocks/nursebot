import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://lvpbwtfvairspufrashl.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const outputPath = process.argv[2] || 'docs/snapshots/authored-room-cases.json';

if (!serviceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function fetchAll(table, columns = '*', pageSize = 500) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

const rooms = await fetchAll('rooms');
const patients = await fetchAll('patients');
const roomIds = new Set(rooms.map((room) => room.id));
const patientIds = new Set(
  patients
    .filter((patient) => roomIds.has(patient.room_id) || rooms.some((room) => room.patient_id === patient.id))
    .map((patient) => patient.id),
);

const allScoped = async (table) => {
  const rows = await fetchAll(table);
  return rows.filter((row) => {
    const patientMatch = row.patient_id && patientIds.has(row.patient_id);
    const roomMatch = row.room_id && roomIds.has(row.room_id);
    const authoredScope = row.override_scope !== 'assignment' && !row.assignment_id;
    return authoredScope && (patientMatch || roomMatch);
  });
};

const [schools, specialties, clinicalNotes, labResults, vitalSigns, medicalOrders, imagingStudies] = await Promise.all([
  fetchAll('schools'),
  fetchAll('specialties'),
  allScoped('clinical_notes'),
  allScoped('lab_results'),
  allScoped('vital_signs'),
  allScoped('medical_orders'),
  allScoped('imaging_studies'),
]);

const referencedSchoolIds = new Set([
  ...rooms.map((room) => room.school_id).filter(Boolean),
  ...patients.map((patient) => patient.school_id).filter(Boolean),
]);

const snapshot = {
  snapshotVersion: 1,
  generatedAt: new Date().toISOString(),
  source: { supabaseUrl, authoredTables: ['rooms', 'patients', 'clinical_notes', 'lab_results', 'vital_signs', 'medical_orders', 'imaging_studies'] },
  exclusionRules: [
    'Excluded assignment-scoped rows and rows with assignment_id.',
    'Excluded student_room_assignments and chat_messages because they are learner-session state.',
    'Retained source rows without normalization or clinical-value correction.',
  ],
  counts: {
    rooms: rooms.length,
    patients: patients.filter((patient) => patientIds.has(patient.id)).length,
    clinicalNotes: clinicalNotes.length,
    labResults: labResults.length,
    vitalSigns: vitalSigns.length,
    medicalOrders: medicalOrders.length,
    imagingStudies: imagingStudies.length,
  },
  schools: schools.filter((school) => referencedSchoolIds.has(school.id)),
  specialties,
  rooms,
  patients: patients.filter((patient) => patientIds.has(patient.id)),
  baselineRecords: {
    clinicalNotes,
    labResults,
    vitalSigns,
    medicalOrders,
    imagingStudies,
  },
};

await mkdir(new URL('.', `file://${process.cwd()}/${outputPath}`).pathname, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outputPath, counts: snapshot.counts }, null, 2));
