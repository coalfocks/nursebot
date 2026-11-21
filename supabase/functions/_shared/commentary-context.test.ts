import { describe, expect, it } from 'vitest';
import { buildCommentaryContext, buildCommentaryRepairContent } from './commentary-context.ts';
import { FEEDBACK_COMMENT_PROMPT } from './feedback-comments.ts';

describe('commentary source-context wiring', () => {
  const source = {
    goals: ['Authored goal A', 'Authored goal B'],
    timeline: '[recorded timestamp] Student message\nDetails:\nLearner asks a specific question.\n\nOrder: synthetic test',
    note: 'Recorded learner note, unchanged.',
    evidenceManifest: 'chat:synthetic | message | Student message\norder:synthetic | order | Synthetic order',
  };

  it('preserves the original initial request byte-for-byte', () => {
    expect(buildCommentaryContext(source)).toBe(`${FEEDBACK_COMMENT_PROMPT}\n\nCASE GOALS:\n${source.goals.join('\n')}\n\nVERIFIED ATTEMPT TIMELINE:\n${source.timeline}\n\nLEARNER NOTE:\n${source.note}\n\nVALID EVIDENCE IDS:\n${source.evidenceManifest}`);
  });

  it('keeps complete source context in repair, including bodies rather than just IDs', () => {
    const initial = buildCommentaryContext(source);
    const candidate = '{"strengths":[],"improvements":[],"unmodified":"candidate\\nbytes"}';
    const repair = buildCommentaryRepairContent(initial, candidate);
    expect(repair.startsWith(initial + '\n\nCANDIDATE JSON TO REPAIR:\n')).toBe(true);
    for (const value of [source.goals[0], source.goals[1], source.timeline, source.note, source.evidenceManifest, candidate]) expect(repair).toContain(value);
    expect(repair.split(FEEDBACK_COMMENT_PROMPT)).toHaveLength(2);
  });

  it('does not fabricate missing source values or convert absence into commentary', () => {
    const result = buildCommentaryContext({ goals: [], timeline: 'No timeline events available.', note: '', evidenceManifest: '' });
    expect(result).toContain('CASE GOALS:\nNot recorded.');
    expect(result).toContain('LEARNER NOTE:\nNot observed.');
    expect(result).not.toContain('Authored goal A');
  });
});
