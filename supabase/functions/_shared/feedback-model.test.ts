import { describe, expect, it } from 'vitest';
import { PINNED_FEEDBACK_MODEL } from './feedback-model';

describe('generate-feedback model pin', () => {
  it('stays on the model production v75 ran (gpt-6-luna)', () => {
    expect(PINNED_FEEDBACK_MODEL).toBe('gpt-6-luna');
  });
});
