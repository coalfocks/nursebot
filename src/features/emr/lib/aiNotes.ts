type NoteType = 'H&P' | 'Progress' | 'Discharge' | 'Consult';

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
  'H&P': (ctx) => {
    const primaryProblem = ctx.caseDescription.split('.')[0] || ctx.caseDescription;
    return [
      'S — Subjective',
      section(
        'Demographics',
        `${ctx.patientName} is a ${ctx.demographic}. Chief complaint: ${ctx.chiefComplaint}`,
      ),
      section('History of Present Illness', ctx.caseDescription),
      section(
        'Review of Systems',
        'Pertinent positives/negatives as per HPI. Denies chest pain, dyspnea, focal neurologic deficits unless otherwise stated.',
      ),
      section('Past Medical History', 'See active problem list. Additional history to be obtained on admission.'),
      section('Past Surgical History', 'Not documented yet.'),
      section('Medications', ctx.medications),
      section('Allergies', ctx.allergies),
      section('Family History', 'Non-contributory per patient report.'),
      section('Social History', 'Tobacco: denies. Alcohol: social or denies. Lives independently; functional baseline preserved.'),
      '',
      'O — Objective',
      section('Vital Signs', 'Reviewed. Abnormal values to be trended on admission.'),
      section(
        'General / Physical Exam',
        'General: alert, oriented, no acute distress. CV: regular rate/rhythm, no murmurs. Pulm: clear bilaterally. Abd: soft, non-distended, non-tender. Neuro: grossly intact. MSK: no focal deficits.',
      ),
      section('Labs & Imaging', 'Pending or not yet available on admission.'),
      '',
      'A — Assessment, P — Plan',
      section(
        'Problem List with Differential',
        `1) ${primaryProblem}\n- Differential and risks to refine with diagnostics.`,
      ),
      section('Primary Clinical Impression', primaryProblem),
      section('Risk Factors / Modifiers', 'To be clarified during admission interview and chart review.'),
      section('Diagnostics', 'Order baseline labs (CBC, BMP, LFTs), consider cultures/imaging as indicated.'),
      section('Therapeutics', 'Supportive care; targeted therapies per evolving impression.'),
      section('Monitoring', 'Serial vitals, I/Os, trend labs, monitor for clinical deterioration.'),
      section('Consults', 'Request specialty input if indicated by admission findings.'),
      section('Patient Education', 'Discuss admission plan, expected workup, and safety precautions.'),
      section('Disposition', 'Admit to appropriate level of care; finalize after initial evaluation.'),
    ]
      .filter(Boolean)
      .join('\n');
  },
  Progress: (ctx) =>
    [
      section(
        'Subjective',
        `${ctx.patientName} notes ${ctx.caseDescription.split('.')[0]?.toLowerCase() || 'improved comfort'}. No overnight events unless otherwise stated.`,
      ),
      section(
        'Objective',
        'Vitals reviewed and stable. Lungs clear, abdomen soft. I/Os reviewed; no acute neuro deficits.',
      ),
      section(
        'Assessment',
        `${ctx.demographic} with ${ctx.caseDescription.toLowerCase()}. Condition stable.`,
      ),
      section(
        'Plan',
        '1) Continue current therapy and home medications as appropriate.\n2) Encourage ambulation, monitor intake/output and pain.\n3) Repeat targeted labs in the morning; escalate to attending if status changes.',
      ),
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
Author: ${author}
==================================================\n\n`;

  return header + content;
}
