import { describe, expect, it } from 'vitest';
import { buildFeedbackContext, buildPatientSummary, resolveExampleProgressNote, selectContextNotes, NOT_PROVIDED, type ContextNote } from './feedback-context';
import { FEEDBACK_CONTEXT_FRAMING_ID, FEEDBACK_CONTEXT_FRAMING_SHA256 } from './feedback-context-framing';

const A = 'assign-1';
const room = { id: 5, example_progress_note: 'EXAMPLE NOTE: problem, escalation, reassessment.', progress_note: 'PRELOADED CHART NOTE', emr_context: null };
const patient = { gender: 'female', date_of_birth: '1990-03-01', service: 'Surgery', admission_date: '2026-10-01', allergies: ['penicillin'], code_status: 'Full' };
const notes: ContextNote[] = [
  { id: 'n1', note_type: 'Progress', title: 'Daily Progress Note 1', author: 'Dr Smith', timestamp: '2026-10-02T10:00:00Z', content: 'baseline progress', override_scope: 'baseline' },
  { id: 'n2', note_type: 'H&P', title: 'Admission H&P', author: 'Dr Jones', timestamp: '2026-10-01T08:00:00Z', content: 'HPI: 5 days of hand swelling.', override_scope: 'room', room_id: 5 },
  { id: 'n3', note_type: 'Progress', title: 'Progress Note', author: 'Student Learner', timestamp: '2026-11-01T10:00:00Z', content: 'LEARNER OWN NOTE', override_scope: 'assignment', assignment_id: A },
  { id: 'n4', note_type: 'Nurse', title: 'Other room', author: 'RN', timestamp: '2026-10-03T10:00:00Z', content: 'OTHER ROOM NOTE', override_scope: 'room', room_id: 99 },
  { id: 'n5', note_type: 'Progress', title: 'Other assignment', author: 'Dr X', timestamp: '2026-10-04T10:00:00Z', content: 'OTHER ASSIGNMENT NOTE', override_scope: 'assignment', assignment_id: 'assign-2' },
  { id: 'n6', note_type: 'Nurse', title: 'Deleted', author: 'RN', timestamp: '2026-10-05T10:00:00Z', content: 'DELETED NOTE', override_scope: 'baseline', deleted_at: '2026-10-06T00:00:00Z' },
];
const base = { assignmentId: A, room, pinned: false, roomLineage: [5], patient, notes, caseGoals: ['Recognize instability.', 'Escalate and reassess.'] };

describe('feedback context block', () => {
  it('contains goals, example note, patient summary, HPI and EMR notes in labeled sections', async () => {
    const ctx = await buildFeedbackContext(base);
    expect(ctx.text).toContain('GRADING REFERENCE 1 - CASE GOALS');
    expect(ctx.text).toContain('- Recognize instability.');
    expect(ctx.text).toContain('GRADING REFERENCE 2 - EXAMPLE PROGRESS NOTE');
    expect(ctx.text).toContain('EXAMPLE NOTE: problem, escalation, reassessment.');
    expect(ctx.text).toContain('CONTEXT ONLY - PATIENT SUMMARY FOR TIMELINE');
    expect(ctx.text).toContain('CONTEXT ONLY - EMR NOTES (not grading criteria)');
    expect(ctx.text).toContain('HPI: 5 days of hand swelling.');
    expect(ctx.patient_summary).toMatch(/36-year-old female; Surgery service/);
    expect(ctx.patient_summary).toContain('Case goals: Recognize instability. | Escalate and reassess.');
    expect(ctx.missing).toEqual([]);
    expect(ctx.fields.hpi).toBe(true);
  });

  it('puts the HPI before other EMR notes and keeps the preloaded room note as context, not the expected note', async () => {
    const ctx = await buildFeedbackContext(base);
    expect(ctx.text.indexOf('Admission H&P')).toBeLessThan(ctx.text.indexOf('Daily Progress Note 1'));
    expect(ctx.text).toContain('[Preloaded room progress note shown to the learner]');
    const expectedSection = ctx.text.slice(ctx.text.indexOf('GRADING REFERENCE 2'), ctx.text.indexOf('CONTEXT ONLY - PATIENT'));
    expect(expectedSection).not.toContain('PRELOADED CHART NOTE');
  });

  it('excludes learner-authored, other-assignment, other-room and deleted notes', () => {
    const picked = selectContextNotes(notes, A, [5]).map((note) => note.id);
    expect(picked).toEqual(['n2', 'n1']);
  });

  it('says NOT PROVIDED and lists missing fields instead of inventing content', async () => {
    const ctx = await buildFeedbackContext({ ...base, room: { id: 5 }, patient: null, notes: [], caseGoals: [] });
    expect(ctx.text.match(new RegExp(NOT_PROVIDED, 'g'))!.length).toBeGreaterThanOrEqual(5);
    expect(ctx.missing).toEqual(expect.arrayContaining(['case_goals', 'example_progress_note', 'patient', 'hpi', 'emr_notes']));
    expect(ctx.patient_summary).toContain(`patient details ${NOT_PROVIDED}`);
    expect(ctx.fields.example_progress_note).toBe(false);
  });

  it('falls back to emr_context.evaluation.modelProgressNote and records the source', () => {
    expect(resolveExampleProgressNote({ emr_context: JSON.stringify({ evaluation: { modelProgressNote: 'MODEL NOTE' } }) })).toEqual({ text: 'MODEL NOTE', source: 'rooms.emr_context.evaluation.modelProgressNote' });
    expect(resolveExampleProgressNote({ example_progress_note: ' direct ', emr_context: { evaluation: { modelProgressNote: 'x' } } }).source).toBe('rooms.example_progress_note');
    expect(resolveExampleProgressNote({ emr_context: '{bad json' })).toEqual({ text: '', source: null });
  });

  it('marks the source as the pinned snapshot when pinned and records provenance ids', async () => {
    const ctx = await buildFeedbackContext({ ...base, pinned: true });
    expect(ctx.source).toBe('pinned_scenario_baseline');
    expect(ctx.text).toContain('pinned scenario snapshot');
    expect(ctx.framing_id).toBe(FEEDBACK_CONTEXT_FRAMING_ID);
    expect(ctx.framing_sha256).toBe(FEEDBACK_CONTEXT_FRAMING_SHA256);
    expect(ctx.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('has a stable hash for identical input and a different hash when text changes', async () => {
    const a = await buildFeedbackContext(base);
    const b = await buildFeedbackContext(base);
    const c = await buildFeedbackContext({ ...base, room: { ...room, example_progress_note: 'changed' } });
    expect(a.sha256).toBe(b.sha256);
    expect(c.sha256).not.toBe(a.sha256);
  });

  it('truncates long notes explicitly and flags it', async () => {
    const long: ContextNote = { id: 'L', note_type: 'H&P', title: 'Long H&P', author: 'MD', timestamp: '2026-10-01T00:00:00Z', content: 'x'.repeat(6000), override_scope: 'baseline' };
    const ctx = await buildFeedbackContext({ ...base, notes: [long] });
    expect(ctx.text).toMatch(/\[truncated 3500 characters\]/);
    expect(ctx.fields.emr_notes_truncated).toBe(true);
  });

  it('never includes patient name or MRN in the summary', () => {
    const summary = buildPatientSummary({ ...patient, first_name: 'Jane', last_name: 'Doe', mrn: '12345' } as never, ['g']);
    expect(summary).not.toMatch(/Jane|Doe|12345/);
  });
});
