import { describe, expect, it } from 'vitest';
import { buildAttemptEvidence, evidenceQueryErrorMessage } from './attemptEvidence';

const boundary = new Date('2026-10-16T05:00:00.000Z').getTime();

describe('attempt evidence fallback', () => {
  it('preserves patient source labels and hides the completion sentinel', () => {
    const evidence = buildAttemptEvidence({
      chat: [
        { id: 'nurse-1', role: 'assistant', content: 'page', created_at: '2026-10-16T05:01:00.000Z' },
        { id: 'done-1', role: 'assistant', content: '<completed>', created_at: '2026-10-16T05:02:00.000Z' },
      ],
      patientChat: [{ id: 'patient-1', role: 'patient', content: 'response', created_at: '2026-10-16T05:03:00.000Z' }],
      orders: [], labs: [], imaging: [], vitals: [], progressNote: null, completedAt: null, boundary,
    });
    expect(evidence.map(({ title }) => title)).toEqual(['Nurse message', 'Patient response']);
    expect(evidence.some(({ body }) => body === '<completed>')).toBe(false);
  });

  it('includes attempt-scoped imaging, vitals, and progress note', () => {
    const evidence = buildAttemptEvidence({
      chat: [], patientChat: [], orders: [], labs: [],
      imaging: [{ id: 'img-1', study_type: 'Chest X-Ray', status: 'Completed', report: 'clear', created_at: '2026-10-16T05:04:00.000Z' }],
      vitals: [{ id: 'vital-1', timestamp: '2026-10-16T05:05:00.000Z', heart_rate: 110 }],
      progressNote: 'Assessment documented.', completedAt: '2026-10-16T05:06:00.000Z', boundary,
    });
    expect(evidence.map(({ id }) => id)).toEqual(['imaging-img-1', 'vital-vital-1', 'progress-note-attempt']);
  });

  it('surfaces evidence query failures instead of treating them as empty', () => {
    expect(evidenceQueryErrorMessage([{ label: 'imaging', error: new Error('permission denied') }])).toContain('imaging: permission denied');
    expect(evidenceQueryErrorMessage([{ label: 'labs', error: null }])).toBeNull();
  });
});
