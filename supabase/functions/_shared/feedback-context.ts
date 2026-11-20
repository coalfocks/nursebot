// Assembles the FEEDBACK CONTEXT section for generate-feedback. Pure: callers pass already-loaded rows.
// Nothing here is invented; any missing field is rendered as "NOT PROVIDED" and listed in `missing`.
import { FEEDBACK_CONTEXT_FRAMING, FEEDBACK_CONTEXT_FRAMING_ID, FEEDBACK_CONTEXT_FRAMING_SHA256 } from './feedback-context-framing.ts';
import { sha256Hex } from './feedback-fingerprint.ts';

export const FEEDBACK_CONTEXT_BUILDER_VERSION = 'feedback-context-builder-v1';
export const NOT_PROVIDED = 'NOT PROVIDED';
const MAX_NOTE_CHARS = 2500;
const MAX_TOTAL_NOTE_CHARS = 10000;

type Row = Record<string, unknown>;
export type ContextNote = { id?: string | null; note_type?: string | null; title?: string | null; author?: string | null; timestamp?: string | null; content?: string | null; override_scope?: string | null; room_id?: number | null; assignment_id?: string | null; deleted_at?: string | null };
export type ContextPatient = { gender?: string | null; date_of_birth?: string | null; service?: string | null; admission_date?: string | null; allergies?: string[] | null; code_status?: string | null } | null;

export type FeedbackContextInput = {
  assignmentId: string;
  /** Live room merged with the pinned scenario_baseline when present (baseline wins). */
  room: Row;
  /** True when scenario_baseline was applied, so provenance can say which text was used. */
  pinned: boolean;
  /** room ids for this room and the rooms it continues from. */
  roomLineage: number[];
  patient: ContextPatient;
  notes: ContextNote[];
  /** Fields the case-key resolver already derived (cleaned case goals). */
  caseGoals: string[];
  asOf?: string | null;
};

export type FeedbackContext = {
  text: string;
  sha256: string;
  builder_version: string;
  framing_id: string;
  framing_sha256: string;
  source: 'pinned_scenario_baseline' | 'live_room';
  fields: { case_goals: boolean; example_progress_note: boolean; example_progress_note_source: string | null; patient_summary: boolean; hpi: boolean; emr_note_count: number; emr_notes_truncated: boolean };
  missing: string[];
  patient_summary: string;
};

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Model/example progress note: example_progress_note, else emr_context.evaluation.modelProgressNote.
 *  rooms.progress_note is the PRELOADED chart note shown to the learner, not the expected note. */
export const resolveExampleProgressNote = (room: Row): { text: string; source: string | null } => {
  const direct = str(room.example_progress_note);
  if (direct) return { text: direct, source: 'rooms.example_progress_note' };
  try {
    const ctx = typeof room.emr_context === 'string' ? JSON.parse(room.emr_context) : room.emr_context;
    const modelNote = str((ctx as Row | null)?.evaluation && ((ctx as Row).evaluation as Row).modelProgressNote);
    if (modelNote) return { text: modelNote, source: 'rooms.emr_context.evaluation.modelProgressNote' };
  } catch { /* malformed emr_context: treat as missing */ }
  return { text: '', source: null };
};

const isLearnerAuthored = (note: ContextNote) => /student|learner/i.test(note.author ?? '');

/** Notes that may appear as context: not deleted, in scope for this assignment, never the learner's own notes. */
export const selectContextNotes = (notes: ContextNote[], assignmentId: string, roomLineage: number[]): ContextNote[] => notes
  .filter((note) => !note.deleted_at && str(note.content))
  .filter((note) => {
    const scope = note.override_scope ?? 'baseline';
    if (scope === 'assignment') return note.assignment_id === assignmentId;
    if (scope === 'room') return roomLineage.includes(note.room_id ?? -1);
    return true;
  })
  .filter((note) => !isLearnerAuthored(note))
  .sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')));

const ageYears = (dob: string | null | undefined, asOf: string | null | undefined): number | null => {
  if (!dob) return null;
  const born = new Date(dob);
  const ref = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(born.getTime()) || Number.isNaN(ref.getTime())) return null;
  let age = ref.getUTCFullYear() - born.getUTCFullYear();
  if (ref.getUTCMonth() < born.getUTCMonth() || (ref.getUTCMonth() === born.getUTCMonth() && ref.getUTCDate() < born.getUTCDate())) age -= 1;
  return age >= 0 ? age : null;
};

/** Short "who the patient is + case goals" line for the timeline. No name or MRN is included. */
export const buildPatientSummary = (patient: ContextPatient, caseGoals: string[], asOf?: string | null): string => {
  const parts: string[] = [];
  if (patient) {
    const age = ageYears(patient.date_of_birth, patient.admission_date ?? asOf);
    const who = [age != null ? `${age}-year-old` : '', str(patient.gender)].filter(Boolean).join(' ');
    if (who) parts.push(who);
    if (str(patient.service)) parts.push(`${str(patient.service)} service`);
    if (str(patient.admission_date)) parts.push(`admitted ${str(patient.admission_date)}`);
    if (str(patient.code_status)) parts.push(`code status ${str(patient.code_status)}`);
    if (patient.allergies?.length) parts.push(`allergies: ${patient.allergies.join(', ')}`);
  }
  const patientText = parts.length ? parts.join('; ') : `patient details ${NOT_PROVIDED}`;
  const goalText = caseGoals.length ? caseGoals.join(' | ') : `case goals ${NOT_PROVIDED}`;
  return `${patientText}. Case goals: ${goalText}`;
};

const clip = (text: string, max: number) => (text.length > max ? { text: `${text.slice(0, max)}\n[truncated ${text.length - max} characters]`, truncated: true } : { text, truncated: false });

export const buildFeedbackContext = async (input: FeedbackContextInput): Promise<FeedbackContext> => {
  const missing: string[] = [];
  const goals = input.caseGoals.filter(Boolean);
  if (!goals.length) missing.push('case_goals');
  const example = resolveExampleProgressNote(input.room);
  if (!example.text) missing.push('example_progress_note');
  if (!input.patient) missing.push('patient');
  const contextNotes = selectContextNotes(input.notes, input.assignmentId, input.roomLineage);
  const preloaded = str(input.room.progress_note);
  const hpiNotes = contextNotes.filter((note) => /^(h&p|hpi|history)/i.test(note.note_type ?? '') || /\bhpi\b|history of present illness|h&p/i.test(note.title ?? ''));
  if (!hpiNotes.length) missing.push('hpi');
  if (!contextNotes.length && !preloaded) missing.push('emr_notes');

  let budget = MAX_TOTAL_NOTE_CHARS;
  let anyTruncated = false;
  let omitted = 0;
  const renderedNotes: string[] = [];
  // HPI first, then the remaining notes oldest-to-newest.
  for (const note of [...hpiNotes, ...contextNotes.filter((n) => !hpiNotes.includes(n))]) {
    if (budget <= 0) { omitted += 1; continue; }
    const body = clip(str(note.content), Math.min(MAX_NOTE_CHARS, budget));
    budget -= body.text.length;
    anyTruncated = anyTruncated || body.truncated;
    renderedNotes.push(`- [${note.note_type ?? 'Note'}] ${note.title ?? 'Untitled'} (${note.author ?? 'author not recorded'}, ${note.timestamp ?? 'time not recorded'})\n${body.text}`);
  }
  if (omitted) { anyTruncated = true; renderedNotes.push(`[${omitted} further note(s) omitted for length]`); }
  if (preloaded) {
    const body = clip(preloaded, MAX_NOTE_CHARS);
    anyTruncated = anyTruncated || body.truncated;
    renderedNotes.push(`- [Preloaded room progress note shown to the learner]\n${body.text}`);
  }

  const patientSummary = buildPatientSummary(input.patient, goals, input.asOf);
  const text = [
    FEEDBACK_CONTEXT_FRAMING,
    '',
    `SOURCE OF CASE TEXT: ${input.pinned ? 'this assignment\'s pinned scenario snapshot' : 'live room record (no pinned snapshot on this assignment)'}`,
    '',
    'GRADING REFERENCE 1 - CASE GOALS:',
    goals.length ? goals.map((goal) => `- ${goal}`).join('\n') : NOT_PROVIDED,
    '',
    'GRADING REFERENCE 2 - EXAMPLE PROGRESS NOTE (compare with the learner\'s progress note):',
    example.text || NOT_PROVIDED,
    '',
    'CONTEXT ONLY - PATIENT SUMMARY FOR TIMELINE:',
    patientSummary,
    '',
    'CONTEXT ONLY - HPI:',
    hpiNotes.length ? 'See the H&P/HPI entries at the start of the EMR notes below.' : NOT_PROVIDED,
    '',
    'CONTEXT ONLY - EMR NOTES (not grading criteria):',
    renderedNotes.length ? renderedNotes.join('\n\n') : NOT_PROVIDED,
  ].join('\n');

  return {
    text,
    sha256: await sha256Hex(text),
    builder_version: FEEDBACK_CONTEXT_BUILDER_VERSION,
    framing_id: FEEDBACK_CONTEXT_FRAMING_ID,
    framing_sha256: FEEDBACK_CONTEXT_FRAMING_SHA256,
    source: input.pinned ? 'pinned_scenario_baseline' : 'live_room',
    fields: { case_goals: goals.length > 0, example_progress_note: Boolean(example.text), example_progress_note_source: example.source, patient_summary: Boolean(input.patient), hpi: hpiNotes.length > 0, emr_note_count: contextNotes.length + (preloaded ? 1 : 0), emr_notes_truncated: anyTruncated },
    missing,
    patient_summary: patientSummary,
  };
};
