type NoteType = 'H&P' | 'Progress' | 'Discharge' | 'Consult' | 'Nursing' | 'Daily';

export interface NoteGenerationRequest {
  patientId: string;
  noteType: NoteType;
  caseDescription: string;
  patientInfo: {
    name: string;
    age: number;
    gender: string;
    chiefComplaint?: string;
    allergies?: string[];
    medications?: string[];
  };
}

type NoteBuilderContext = {
  caseDescription: string;
  allergies: string;
  chiefComplaint: string;
  medications: string;
  patientName: string;
  demographic: string;
};

const section = (title: string, body: string) => `${title}:\n${body.trim()}\n`;

const buildContext = (request: NoteGenerationRequest): NoteBuilderContext => {
  const { patientInfo, caseDescription } = request;
  const allergies = patientInfo.allergies?.length ? patientInfo.allergies.join(', ') : 'NKDA';
  const meds = patientInfo.medications?.length ? patientInfo.medications.join(', ') : 'Refer to MAR';
  const chiefComplaint = patientInfo.chiefComplaint ?? 'Refer to triage notes for details.';
  const demographic = `${patientInfo.age}-year-old ${patientInfo.gender.toLowerCase()}`;

  return {
    caseDescription,
    allergies,
    chiefComplaint,
    medications: meds,
    patientName: patientInfo.name,
    demographic,
  };
};

const noteBuilders: Record<NoteType, (ctx: NoteBuilderContext) => string> = {
  'H&P': (ctx) =>
    [
      section('Chief Complaint', ctx.chiefComplaint),
      section('History of Present Illness', ctx.caseDescription),
      section('Past Medical History', 'See active problem list.'),
      section('Medications', ctx.medications),
      section('Allergies', ctx.allergies),
      section('Social History', 'Lives independently. Denies tobacco, alcohol, or illicit drugs.'),
      section('Family History', 'Non-contributory per patient report.'),
      section(
        'Review of Systems',
        'Negative unless noted in HPI. No fever/chills. No new neurological deficits.',
      ),
      section(
        'Physical Examination',
        'General: Alert, oriented, no acute distress.\nCV: Regular rate and rhythm.\nPulm: Clear to auscultation.\nAbd: Soft, non-distended.',
      ),
      section(
        'Assessment & Plan',
        `1. ${ctx.caseDescription.split('.')[0]}. Continue diagnostics and supportive care.\n2. Pain control as needed.\n3. Monitor labs and vitals closely.`,
      ),
    ].join('\n'),
  Progress: (ctx) =>
    [
      section(
        'Subjective',
        `${ctx.patientName} reports improved comfort. No overnight events.`,
      ),
      section(
        'Objective',
        'Vitals stable. Lungs clear. Abdomen soft. Labs pending this morning.',
      ),
      section(
        'Assessment',
        `${ctx.demographic} with ${ctx.caseDescription.toLowerCase()}. Stable condition.`,
      ),
      section(
        'Plan',
        'Maintain current therapy, encourage ambulation, repeat labs tomorrow, update attending if status changes.',
      ),
    ].join('\n'),
  Daily: (ctx) =>
    [
      section('Overnight Events', 'None reported.'),
      section('Current Condition', 'Awake, oriented, pain well controlled.'),
      section('Treatments', ctx.medications),
      section('Plan for the Day', 'Advance diet as tolerated, monitor intake/output, coordinate family update.'),
      section('Concerns', ctx.caseDescription),
    ].join('\n'),
  Nursing: () =>
    [
      section('General Condition', 'Resting comfortably in bed, fall precautions maintained.'),
      section('Pain & Comfort', 'Rates pain 3/10, relieved with scheduled medication.'),
      section('Mobility', 'Ambulated with standby assist; steady gait.'),
      section('Education', 'Reinforced medication schedule and call-light use.'),
      section('Family Interaction', 'Family updated at bedside, questions answered.'),
    ].join('\n'),
  Consult: (ctx) =>
    [
      section('Reason for Consult', ctx.caseDescription.split('.')[0]),
      section(
        'Focused History',
        `${ctx.demographic} with pertinent history as noted. No contraindications to recommended therapy.`,
      ),
      section('Exam Highlights', 'Neuro intact, hemodynamically stable, targeted exam reassuring.'),
      section('Impression', ctx.caseDescription),
      section('Recommendations', 'Continue current management, consider imaging if symptoms progress, we will follow.'),
    ].join('\n'),
  Discharge: (ctx) =>
    [
      section('Admission Diagnosis', ctx.caseDescription.split('.')[0]),
      section('Hospital Course', 'Treated with supportive care, gradual improvement noted.'),
      section('Discharge Medications', ctx.medications),
      section('Follow-up', 'Primary care in 1 week, specialist follow-up as needed.'),
      section('Instructions', 'Monitor for worsening pain, fever, or bleeding. Return for concerning symptoms.'),
    ].join('\n'),
};

export async function generateClinicalNote(request: NoteGenerationRequest): Promise<string> {
  const builder = noteBuilders[request.noteType];
  const context = buildContext(request);
  return Promise.resolve(
    `Patient: ${context.patientName} (${context.demographic})\n${builder(context)}`.trim(),
  );
}

export function formatNoteForDisplay(content: string, noteType: string, author: string, timestamp: string): string {
  const header = `${noteType.toUpperCase()} NOTE
Date/Time: ${new Date(timestamp).toLocaleString()}
Author: ${author}
==================================================\n\n`;

  return header + content;
}
