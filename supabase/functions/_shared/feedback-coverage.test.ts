import { describe, expect, it } from 'vitest';
import { buildSourceCoverage } from './feedback-coverage';

const entries = [
  { kind: 'learner-action', actor_role: 'student' },
  { kind: 'message', actor_role: 'assistant' },
  { kind: 'message', actor_role: 'patient' },
  { kind: 'consultant-message', actor_role: 'consultant' },
];

describe('source coverage', () => {
  it('treats a successful zero-row order query as an available empty source', () => {
    const coverage = buildSourceCoverage(entries, { manifestAvailable: true, progressNotePresent: true, caseKeyGoalCount: 2 });
    expect(coverage.orders_results).toBe('available_empty');
    expect(coverage.nurse_messages).toBe('available_with_events');
    expect(coverage.patient_messages).toBe('available_with_events');
    expect(coverage.consultant_messages).toBe('available_with_events');
    expect(coverage.learner_actions).toBe('available_with_events');
  });

  it('marks every source unavailable when the manifest could not be read', () => {
    const coverage = buildSourceCoverage([], { manifestAvailable: false, progressNotePresent: true, caseKeyGoalCount: 2 });
    expect(Object.values(coverage).every((status) => status === 'unavailable' || status === 'available_with_events')).toBe(true);
    expect(coverage.orders_results).toBe('unavailable');
    expect(coverage.nurse_messages).toBe('unavailable');
  });

  it('records a missing progress note as an available empty source, not unavailable', () => {
    const coverage = buildSourceCoverage(entries, { manifestAvailable: true, progressNotePresent: false, caseKeyGoalCount: 2 });
    expect(coverage.progress_note).toBe('available_empty');
  });

  it('does not count patient or consultant messages as learner actions', () => {
    const coverage = buildSourceCoverage([{ kind: 'message', actor_role: 'patient' }, { kind: 'consultant-message', actor_role: 'consultant' }], { manifestAvailable: true, progressNotePresent: true, caseKeyGoalCount: 1 });
    expect(coverage.learner_actions).toBe('available_empty');
  });
});
