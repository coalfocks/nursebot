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
      section('Demographics', `${ctx.patientName} is a ${ctx.demographic}.`),
      section('Chief Complaint', ctx.chiefComplaint),
      section('History of Present Illness', ctx.caseDescription),
      section('Review of Systems', 'Pertinent positives/negatives as per HPI. Denies CP/SOB unless otherwise stated.'),
      section('Past Medical History', 'See active problem list.'),
      section('Past Surgical History', 'Not documented on admission.'),
      section('Medications', ctx.medications),
      section('Allergies', ctx.allergies),
      section('Family History', 'Non-contributory unless otherwise specified.'),
      section('Social History', 'Tobacco: denies. Alcohol: social/denies. Lives independently; baseline functional.'),
      'O — Objective',
      section('Vital Signs', 'Reviewed; notable abnormals to be trended on admission.'),
      section(
        'General Appearance',
        'Awake, alert, oriented. No acute distress unless otherwise specified.',
      ),
      section(
        'Physical Exam',
        'CV: RRR, no murmurs. Pulm: CTAB. Abd: soft, NT/ND. Neuro: grossly intact. Skin: warm, perfused.',
      ),
      section('Labs & Imaging', 'Pending/ordered; none resulted yet unless stated.'),
      'A — Assessment, P — Plan',
      section(
        'Problem List with Differential',
        `1) ${primaryProblem}\n- Differential and risk factors to refine with diagnostics.`,
      ),
      section('Primary Clinical Impression', primaryProblem),
      section('Risk Factors / Modifiers', 'To be clarified on full admission interview and chart review.'),
      section('Diagnostics', 'CBC, BMP, LFTs, cultures/imaging as indicated.'),
      section('Therapeutics', 'Supportive care; targeted meds/fluids/procedures per evolving impression.'),
      section('Monitoring', 'Serial vitals, I/Os, trend labs, watch for deterioration.'),
      section('Consults', 'Engage specialty consults as indicated by presenting problem.'),
      section('Patient Education', 'Discuss admission plan, safety, expected workup.'),
      section('Disposition', 'Admit to appropriate level; reassess after initial diagnostics.'),
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

export function formatNoteForDisplay(content: string, noteType: string, author: string): string {
  const header = `${noteType.toUpperCase()} NOTE
Author: ${author}
==================================================\n\n`;

  return header + content;
}
