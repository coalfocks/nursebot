import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static guards for the Complete flow: the learner completion path must use the scoped, idempotent trigger.
const source = readFileSync('src/components/ChatInterface.tsx', 'utf8');
const completion = source.slice(source.indexOf('const completeAssignment'), source.indexOf('const closeCompletionConfirm'));

describe('ChatInterface completion -> feedback', () => {
  it('requests feedback only through the scoped auto trigger for this assignment', () => {
    expect(completion).toContain('requestAutoFeedback(assignmentId)');
    expect(completion).not.toContain("invoke('generate-feedback'");
    expect(source).not.toMatch(/checkPendingFeedback|generateFeedback\(/);
  });
  it('guards the completion write so a second Complete / reload cannot re-complete or reset feedback', () => {
    expect(completion).toContain(".neq('status', 'completed')");
    expect(completion).toContain('.maybeSingle()');
  });
});
