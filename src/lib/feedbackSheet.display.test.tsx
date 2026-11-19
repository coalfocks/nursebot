import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeedbackSheet, mapFeedbackSheet, renderFeedbackSheetHtml } from './feedbackSheet';

const assignment = {
  communication_score: 3,
  mdm_score: 3,
  communication_breakdown: {
    focused_information_gathering: { score: 1, feedback: 'You asked about oxygen.', evidence_event_ids: ['message-10'] },
    closed_loop_team_communication: { score: 2, feedback: 'You acknowledged the nurse reply.' },
    efficiency_deduction: { score: 0, feedback: 'No interference.' },
  },
  mdm_breakdown: {
    orders_monitoring_quality: { score: 2, feedback: 'You used the active PRN.' },
    clinical_reasoning_documentation: { score: 1, feedback: 'Partial note.' },
    safety_deduction: { score: 0, feedback: 'No unsafe action.' },
  },
  safety_result: { level: 'none', action: null, rationale: null },
  feedback_debrief: {
    action_review: { items: [{ label: 'Order: Lorazepam', explanation: 'Placed by learner', evidence_event_ids: ['order:o1'] }] },
    strengths: ['You asked the nurse about oxygen and vitals.', 'You ordered the PRN with a clear dose.'],
    improvements: ['Repeat vitals sooner after the PRN.', 'Name the reassessment time in your note.'],
  },
};

describe('learner-facing feedback sheet', () => {
  it('omits the Observed actions and orders section from the preview', () => {
    const model = mapFeedbackSheet(assignment);
    const preview = renderToStaticMarkup(createElement(FeedbackSheet, { model }));
    expect(preview).not.toContain('Observed actions and orders');
    expect(preview).toContain('You asked the nurse about oxygen and vitals.');
    expect(preview).toContain('Repeat vitals sooner after the PRN.');
  });

  it('omits the same section from the downloaded sheet and keeps scores and both comment lists', () => {
    const model = mapFeedbackSheet(assignment);
    const html = renderFeedbackSheetHtml(model);
    expect(html).not.toContain('Observed actions and orders');
    expect(html).toContain('Specific strengths');
    expect(html).toContain('Actionable improvements');
    expect(html).toContain('Name the reassessment time in your note.');
  });

  it('keeps the underlying action evidence in the model for internal use', () => {
    const model = mapFeedbackSheet(assignment);
    expect(model.actions).toEqual([{ label: 'Order: Lorazepam', detail: 'Placed by learner' }]);
  });
});
