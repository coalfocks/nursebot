import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FEEDBACK_SHEET_LABELS, FeedbackSheet, commentIntegrityErrors, mapFeedbackSheet, renderFeedbackSheetHtml } from './feedbackSheet';

const canonicalImprovements = [
  { text: 'Go to the bedside as soon as the nurse reports 83% on the mask.', evidence_event_ids: ['chat:ea246d21'] },
  { text: 'Confirm critical-care review aloud before you finish the case.', evidence_event_ids: ['chat:5b2d37c0'] },
];
const canonicalStrengths = [
  { text: 'You asked for the NRB settings and oxygen saturation before acting.', evidence_event_ids: ['chat:84b4e108'] },
  { text: 'You placed the stat ABG order, which tested the hypoxia you had identified.', evidence_event_ids: ['order:df5b6a30'] },
];
// Legacy copies carry different wording from an older generation. They must never appear next to the canonical list.
const legacyImprovements = ['Old legacy improvement one about reassessment timing.', 'Old legacy improvement two about the nurse plan.'];

const base = {
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
  safety_result: { level: 'none', action: null, rationale: 'No unsafe action was recorded.' },
  feedback_generated_at: '2026-11-18T12:00:00Z',
  feedback_debrief: {
    case_goals: ['Recognize hypoxia and escalate oxygen therapy.'],
    strengths: canonicalStrengths,
    improvements: canonicalImprovements,
  },
  nurse_feedback: {
    clinical_reasoning: { strengths: ['Legacy strength.'], areas_for_improvement: legacyImprovements },
    communication_skills: { strengths: ['Legacy strength.'], areas_for_improvement: legacyImprovements },
  },
};

// Round-trip through JSON so the test sees exactly what a reload from storage returns.
const reload = (value: unknown) => JSON.parse(JSON.stringify(value));

// React static markup splits text nodes with <!-- --> comments; drop them so one visible line stays one line.
const visibleText = (html: string) => html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);

const headings = (html: string) => [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((match) => visibleText(match[1]).join(' '));

describe('comment source selection', () => {
  it('canonical plus legacy present: canonical wins and the legacy copy is never merged in', () => {
    const model = mapFeedbackSheet(reload(base) as never);
    expect(model.improvements).toEqual(canonicalImprovements.map((item) => item.text));
    expect(model.strengths).toEqual(canonicalStrengths.map((item) => item.text));
    expect(model.commentIntegrity).toEqual([]);
    const preview = renderToStaticMarkup(createElement(FeedbackSheet, { model }));
    const download = renderFeedbackSheetHtml(model);
    for (const html of [preview, download]) {
      expect(html).not.toContain('Old legacy improvement');
      expect(visibleText(html).filter((line) => line.startsWith('Confirm critical-care') || line.startsWith('Go to the bedside'))).toHaveLength(2);
    }
  });

  it('legacy only: uses the legacy list when the canonical field is genuinely absent', () => {
    const model = mapFeedbackSheet(reload({ ...base, feedback_debrief: { case_goals: base.feedback_debrief.case_goals } }) as never);
    expect(model.improvements).toEqual(legacyImprovements);
    // One legacy strength is a count failure, reported and not padded.
    expect(model.strengths).toEqual(['Legacy strength.']);
    expect(model.commentIntegrity).toEqual(['Strengths: 1 saved (expected 2)']);
  });

  it('a present but empty canonical list does not fall back to the legacy copy', () => {
    const model = mapFeedbackSheet(reload({ ...base, feedback_debrief: { ...base.feedback_debrief, improvements: [] } }) as never);
    expect(model.improvements).toEqual([]);
    expect(model.commentIntegrity).toContain('Improvements: 0 saved (expected 2)');
  });
});

describe('invalid comment counts are reported, never padded, truncated, or merged', () => {
  const cases: Array<{ name: string; improvements: unknown[]; expectError: string }> = [
    { name: 'zero', improvements: [], expectError: 'Improvements: 0 saved (expected 2)' },
    { name: 'one', improvements: [canonicalImprovements[0]], expectError: 'Improvements: 1 saved (expected 2)' },
    {
      name: 'three',
      improvements: [...canonicalImprovements, { text: 'A third genuine improvement about the note.', evidence_event_ids: ['note'] }],
      expectError: 'Improvements: 3 saved (expected 2)',
    },
    {
      name: 'four',
      improvements: [...canonicalImprovements, { text: 'A third genuine improvement about the note.', evidence_event_ids: ['note'] }, { text: 'A fourth genuine improvement about handoff.', evidence_event_ids: ['note'] }],
      expectError: 'Improvements: 4 saved (expected 2)',
    },
    {
      name: 'duplicates',
      improvements: [canonicalImprovements[0], { text: '  GO TO THE BEDSIDE as soon as the nurse reports 83% on the mask. ', evidence_event_ids: ['chat:x'] }],
      expectError: 'Improvements: contains duplicate text',
    },
  ];
  for (const testCase of cases) {
    it(`${testCase.name} improvements: stored count is shown as stored and the error is flagged`, () => {
      const model = mapFeedbackSheet(reload({ ...base, feedback_debrief: { ...base.feedback_debrief, improvements: testCase.improvements } }) as never);
      expect(model.improvements).toHaveLength(testCase.improvements.length);
      expect(model.commentIntegrity).toContain(testCase.expectError);
      // Legacy copy never fills the gap.
      expect(model.improvements.join(' ')).not.toContain('Old legacy');
    });
  }

  it('commentIntegrityErrors accepts exactly two distinct comments', () => {
    expect(commentIntegrityErrors('Strengths', ['One sentence here.', 'Another sentence here.'])).toEqual([]);
    expect(commentIntegrityErrors('Strengths', ['Same.', 'same.'])).toEqual(['Strengths: contains duplicate text']);
  });
});

describe('preview, download and print use the same stored result and labels', () => {
  it('shared labels are the only heading text for the sheet and match between preview and download', () => {
    const model = mapFeedbackSheet(reload(base) as never);
    const preview = renderToStaticMarkup(createElement(FeedbackSheet, { model }));
    const download = renderFeedbackSheetHtml(model);
    expect(headings(preview)).toEqual(headings(download));
    for (const label of [FEEDBACK_SHEET_LABELS.title, FEEDBACK_SHEET_LABELS.caseGoals, FEEDBACK_SHEET_LABELS.communication, FEEDBACK_SHEET_LABELS.clinicalReasoning, FEEDBACK_SHEET_LABELS.separateSafety, FEEDBACK_SHEET_LABELS.strengths, FEEDBACK_SHEET_LABELS.improvements]) {
      expect(visibleText(preview)).toContain(label);
      expect(visibleText(download)).toContain(label);
    }
    expect(preview).not.toContain('Review feedback<');
    expect(download).not.toContain('Clinical Reasoning');
  });

  it('identical content after reload: the same visible lines in preview and download, with scores and goals intact', () => {
    const model = mapFeedbackSheet(reload(base) as never);
    const previewLines = visibleText(renderToStaticMarkup(createElement(FeedbackSheet, { model })));
    const downloadLines = visibleText(renderFeedbackSheetHtml(model));
    const contentOf = (lines: string[]) => lines.filter((line) => !['Review your feedback', FEEDBACK_SHEET_LABELS.kicker].includes(line));
    expect(contentOf(previewLines).filter((line) => line.includes(' · Room') || line.startsWith('Recorded'))).toEqual(contentOf(downloadLines).filter((line) => line.includes(' · Room') || line.startsWith('Recorded')));
    const expectedLines = [
      ...canonicalImprovements.map((item) => item.text),
      ...canonicalStrengths.map((item) => item.text),
      'Recognize hypoxia and escalate oxygen therapy.',
      'Focused information gathering (0–2): 1',
      'No unsafe action was recorded.',
    ];
    for (const line of expectedLines) {
      expect(previewLines).toContain(line);
      expect(downloadLines).toContain(line);
    }
    expect(previewLines).toContain('3/5');
    expect(downloadLines).toContain('3/5');
    expect(previewLines.join('\n')).not.toContain('Observed actions and orders');
    expect(downloadLines.join('\n')).not.toContain('Observed actions and orders');
  });
});

describe('invalid saved counts fail visibly in preview and download', () => {
  it('shows the integrity notice with the stored items unchanged', () => {
    const model = mapFeedbackSheet(reload({ ...base, feedback_debrief: { ...base.feedback_debrief, improvements: [canonicalImprovements[0]] } }) as never);
    const preview = visibleText(renderToStaticMarkup(createElement(FeedbackSheet, { model })));
    const download = visibleText(renderFeedbackSheetHtml(model));
    for (const lines of [preview, download]) {
      expect(lines).toContain(FEEDBACK_SHEET_LABELS.commentIntegrity);
      expect(lines).toContain('Improvements: 1 saved (expected 2)');
      expect(lines).toContain(canonicalImprovements[0].text);
      expect(lines.join(' ')).not.toContain('Old legacy');
    }
  });

  it('shows no integrity notice for a valid two-and-two result', () => {
    const model = mapFeedbackSheet(reload(base) as never);
    expect(visibleText(renderToStaticMarkup(createElement(FeedbackSheet, { model })))).not.toContain(FEEDBACK_SHEET_LABELS.commentIntegrity);
    expect(visibleText(renderFeedbackSheetHtml(model))).not.toContain(FEEDBACK_SHEET_LABELS.commentIntegrity);
  });
});
