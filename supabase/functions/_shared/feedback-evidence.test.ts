import { describe, expect, it } from 'vitest';
import { buildLearnerClosedLoopEvidenceIds, buildLearnerCommunicationEvidenceIds } from './feedback-evidence';
import type { EvaluationTimelineEntry } from './assignment-timeline';

const entry = (overrides: Partial<EvaluationTimelineEntry>): EvaluationTimelineEntry => ({
  id: 'event', kind: 'message', timestamp: '2026-10-29T00:00:00.000Z', title: 'event', ...overrides,
});

describe('feedback evidence semantics', () => {
  it('keeps mixed-channel learner actions in closed-loop evidence without crediting replies', () => {
    const entries = [
      entry({ id: 'nurse-question', kind: 'message', meta: ['Author: Student'] }),
      entry({ id: 'nurse-reply', kind: 'message', meta: ['Author: Nurse'] }),
      entry({ id: 'consult-request', kind: 'consultant-message', meta: ['Urgency: urgent', 'Author: Student'] }),
      entry({ id: 'consult-reply', kind: 'consultant-message', meta: ['Urgency: urgent', 'Author: Consultant'] }),
      entry({ id: 'patient-question', kind: 'patient-message', meta: ['Channel: patient', 'Author: Student'] }),
      entry({ id: 'team-escalation', kind: 'learner-action', title: 'Learner team escalation', meta: ['Channel: consultant', 'Author: Student'] }),
      entry({ id: 'bedside-observation', kind: 'learner-action', title: 'Learner bedside finding', meta: ['Channel: bedside', 'Author: Student'] }),
    ];

    expect(buildLearnerCommunicationEvidenceIds(entries)).toEqual([
      'nurse-question', 'consult-request', 'patient-question', 'team-escalation', 'bedside-observation',
    ]);
    expect(buildLearnerClosedLoopEvidenceIds(entries)).toEqual(['nurse-question', 'consult-request', 'team-escalation']);
    expect(buildLearnerClosedLoopEvidenceIds(entries)).not.toContain('nurse-reply');
    expect(buildLearnerClosedLoopEvidenceIds(entries)).not.toContain('consult-reply');
  });
});
