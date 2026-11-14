import { describe, expect, it } from 'vitest';
import { manifestEventToEvaluationEntry } from './feedback-manifest';

const event = (overrides: Record<string, unknown>) => ({ event_id: 'id', event_type: 'student_message', occurred_at: '2026-11-14T10:00:00.000Z', actor: { role: 'student' }, channel: 'chat', content: { text: 'x' }, sequence: 1, ...overrides });

describe('manifest to evaluation entries', () => {
  it('keeps learner bedside actions as learner-authored entries with their own id and time', () => {
    const entry = manifestEventToEvaluationEntry(event({ event_id: 'bed-1', event_type: 'bedside_action', actor: { role: 'student' }, channel: 'bedside', content: { text: 'Reassessed perfusion' } }));
    expect(entry).toMatchObject({ id: 'bed-1', kind: 'learner-action', actor_role: 'student', channel: 'bedside', timestamp: '2026-11-14T10:00:00.000Z' });
  });

  it('keeps nurse, patient, and consultant events attributed to their own actors', () => {
    const nurse = manifestEventToEvaluationEntry(event({ event_id: 'n-1', event_type: 'nurse_message', actor: { role: 'assistant' }, channel: 'chat' }));
    const patient = manifestEventToEvaluationEntry(event({ event_id: 'p-1', event_type: 'patient_message', actor: { role: 'patient' }, channel: 'chat' }));
    const consultant = manifestEventToEvaluationEntry(event({ event_id: 'c-1', event_type: 'consultant_response', actor: { role: 'consultant' }, channel: 'consult' }));
    expect(nurse?.actor_role).toBe('assistant');
    expect(nurse?.meta).toContain('Author: Nurse');
    expect(patient?.meta).toContain('Author: Patient');
    expect(patient?.actor_role).not.toBe('student');
    expect(consultant?.kind).toBe('consultant-message');
    expect(consultant?.actor_role).toBe('consultant');
  });

  it('marks system hints as not learner actions', () => {
    const hint = manifestEventToEvaluationEntry(event({ event_id: 'h-1', event_type: 'hint_shown', actor: { role: 'system' } }));
    expect(hint?.meta).toContain('System hint shown; not a learner action');
  });

  it('drops events without an id and never invents one', () => {
    expect(manifestEventToEvaluationEntry(event({ event_id: undefined }))).toBeNull();
  });
});
