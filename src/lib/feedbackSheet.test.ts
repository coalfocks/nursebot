import { describe, expect, it } from 'vitest';
import { mapFeedbackSheet, renderFeedbackSheetHtml } from './feedbackSheet';

describe('feedback sheet mapping and rendering', () => {
  it('maps only saved feedback fields and preserves missing sections', () => {
    const model = mapFeedbackSheet({
      id: 'assignment-1',
      student: { full_name: 'Alex Student' },
      room: { room_number: '12' },
      feedback_generated_at: '2026-10-27T12:00:00.000Z',
      feedback_version: 'v3',
      feedback_debrief: {
        case_goals: ['Assess airway', 'Escalate deterioration'],
        strengths: ['Clear handoff'],
        improvements: ['Document response to intervention'],
        action_review: { items: [{ label: 'Oxygen order', assessment: 'Appropriate and timely.' }] },
      },
      communication_breakdown: {
        focused_information_gathering: { score: 2, feedback: 'Asked focused questions.' },
      },
      mdm_breakdown: null,
      safety_result: null,
      communication_score: 4,
      mdm_score: null,
      learning_objectives: null,
    });

    expect(model.studentName).toBe('Alex Student');
    expect(model.goals).toEqual(['Assess airway', 'Escalate deterioration']);
    expect(model.communication[0]).toMatchObject({ score: '2', feedback: 'Asked focused questions.' });
    expect(model.communication[1].score).toBe('Not recorded');
    expect(model.actions[0].detail).toBe('Appropriate and timely.');
    expect(model.safety).toBeNull();
  });

  it('renders human-readable escaped HTML with a print-ready document body', () => {
    const html = renderFeedbackSheetHtml(mapFeedbackSheet({
      student_name: 'A < B',
      room_number: '7',
      feedback_debrief: { strengths: ['Use <closed-loop> communication'] },
      communication_breakdown: {},
      mdm_breakdown: {},
    }));

    expect(html).toContain('Review your feedback');
    expect(html).toContain('A &lt; B');
    expect(html).toContain('Use &lt;closed-loop&gt; communication');
    expect(html).toContain('Not recorded.');
    expect(html).not.toContain('"feedback_debrief"');
  });

  it('removes authoring-only instructions from reader-facing goals', () => {
    const model = mapFeedbackSheet({
      room: { room_number: '7', case_goals: ['Reveal this goal only in post-case feedback.', 'Assess airway and escalate deterioration.'] },
      feedback_debrief: { case_goals: ['Do not disclose the target diagnosis or goals through nurse or patient conversation before case completion.'] },
    });
    expect(model.goals).toEqual(['Assess airway and escalate deterioration.']);
  });
});
